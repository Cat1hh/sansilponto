const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

// 1. FORÇA O FUSO HORÁRIO NO NODE.JS (Urgente para Railway)
process.env.TZ = "America/Sao_Paulo";

const app = express();

// --- CONEXÃO COM O BANCO DE DADOS ---
const db = mysql.createPool({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER || 'root',
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // AJUSTE: Força o fuso horário de Brasília na conexão do MySQL
    timezone: '-03:00' 
});

// 1. Inicialização das tabelas com PIN e CASCADE
async function initDb() {
    try {
        await db.query(`CREATE TABLE IF NOT EXISTS funcionarios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(255),
            senha VARCHAR(10) DEFAULT '1234', 
            horario_almoco VARCHAR(50),
            dias_trabalho VARCHAR(255),
            id_biometria VARCHAR(255)
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS registros_ponto (
            id INT AUTO_INCREMENT PRIMARY KEY,
            funcionario_id INT,
            data DATE,
            hora TIME,
            tipo VARCHAR(100),
            FOREIGN KEY(funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE
        )`);

        console.log("✅ Tabelas prontas (Fuso Horário Brasília configurado)");
    } catch (err) {
        console.error("❌ Erro ao criar tabelas:", err);
    }
}
initDb();

// --- CONFIGURAÇÕES ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname)); 

// --- ROTAS ADMINISTRATIVAS ---

app.get('/admin/pontos', async (req, res) => {
    try {
        const sql = `
            SELECT f.nome as funcionario, r.data, r.hora, r.tipo 
            FROM registros_ponto r 
            JOIN funcionarios f ON r.funcionario_id = f.id 
            ORDER BY r.data DESC, r.hora DESC`;
        const [rows] = await db.query(sql);
        res.json({ pontos: rows });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.delete('/admin/excluir-funcionario/:nome', async (req, res) => {
    const nome = decodeURIComponent(req.params.nome);
    try {
        const [func] = await db.query("SELECT id FROM funcionarios WHERE nome = ?", [nome]);
        if (func.length > 0) {
            const funcionarioId = func[0].id;
            // Limpeza manual para garantir que não trave
            await db.query("DELETE FROM registros_ponto WHERE funcionario_id = ?", [funcionarioId]);
            await db.query("DELETE FROM funcionarios WHERE id = ?", [funcionarioId]);
            res.json({ success: true, message: "Funcionário e histórico removidos!" });
        } else {
            res.status(404).json({ success: false, message: "Funcionário não encontrado." });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro ao excluir: " + err.message });
    }
});

app.post('/admin/cadastrar-funcionario', async (req, res) => {
    const { id, nome, senha, turnoAlmoco, diasTrabalho, id_biometria } = req.body;
    try {
        if (id) {
            const sqlUpdate = `
                UPDATE funcionarios 
                SET nome = ?, senha = ?, horario_almoco = ?, dias_trabalho = ?, id_biometria = ? 
                WHERE id = ?`;
            await db.query(sqlUpdate, [nome, senha, turnoAlmoco, diasTrabalho, id_biometria, id]);
            res.json({ message: "Dados atualizados!" });
        } else {
            const sqlInsert = "INSERT INTO funcionarios (nome, senha, horario_almoco, dias_trabalho, id_biometria) VALUES (?, ?, ?, ?, ?)";
            await db.query(sqlInsert, [nome, senha || '1234', turnoAlmoco, diasTrabalho, id_biometria]);
            res.json({ message: "Cadastrado com sucesso!" });
        }
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/admin/equipe', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, nome, senha, horario_almoco, dias_trabalho, id_biometria FROM funcionarios");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --- REGISTRO DE PONTO (SISTEMA COM HORA CORRIGIDA) ---
app.post('/bater-ponto', async (req, res) => {
    const { funcionario, senha, tipo } = req.body;
    try {
        const [rows] = await db.query("SELECT id, senha FROM funcionarios WHERE nome = ?", [funcionario]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: "Funcionário não encontrado." });
        
        if (rows[0].senha !== senha) {
            return res.status(401).json({ success: false, message: "PIN incorreto!" });
        }

        const funcId = rows[0].id;
        
        // AJUSTE DE HORA: Capturando exatamente o momento em São Paulo
        const agora = new Date();
        const dataHoje = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); 
        const horaAtual = agora.toLocaleTimeString('pt-BR', { 
            hour12: false, 
            timeZone: 'America/Sao_Paulo' 
        });

        // Lógica de atraso baseada na hora local de SP
        let tipoFinal = tipo;
        const partesHora = horaAtual.split(':');
        const horaH = parseInt(partesHora[0]);
        const minutoM = parseInt(partesHora[1]);

        if (tipo.includes("Entrada")) {
            // Se for após 05:55 (Atraso)
            if (horaH > 5 || (horaH === 5 && minutoM > 55)) {
                tipoFinal = `${tipo} (⚠️ ATRASO)`;
            }
        }

        await db.query("INSERT INTO registros_ponto (funcionario_id, data, hora, tipo) VALUES (?, ?, ?, ?)", 
            [funcId, dataHoje, horaAtual, tipoFinal]);
        
        res.json({ success: true, message: `Ponto registrado às ${horaAtual}!` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Erro ao salvar ponto." });
    }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Sansil Rodando na porta ${PORT}`);
});
