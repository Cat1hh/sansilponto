const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
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
    queueLimit: 0
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

        console.log("✅ Tabelas prontas (PIN e Exclusão em Cascata ativos)");
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

// ROTA DE EXCLUSÃO CORRIGIDA (FOCO AQUI)
app.delete('/admin/excluir-funcionario/:nome', async (req, res) => {
    const nome = decodeURIComponent(req.params.nome);
    try {
        // Buscamos o ID primeiro para garantir a exclusão correta
        const [func] = await db.query("SELECT id FROM funcionarios WHERE nome = ?", [nome]);
        
        if (func.length > 0) {
            // Ao deletar pelo ID, o CASCADE apaga os pontos automaticamente
            await db.query("DELETE FROM funcionarios WHERE id = ?", [func[0].id]);
            res.json({ message: "Funcionário e histórico excluídos com sucesso!" });
        } else {
            res.status(404).json({ message: "Funcionário não encontrado." });
        }
    } catch (err) {
        res.status(500).json({ message: "Erro ao excluir: " + err.message });
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

// --- REGISTRO DE PONTO (SISTEMA DE PIN) ---
app.post('/bater-ponto', async (req, res) => {
    const { funcionario, senha, tipo } = req.body;
    try {
        const [rows] = await db.query("SELECT id, senha FROM funcionarios WHERE nome = ?", [funcionario]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: "Funcionário não encontrado." });
        
        if (rows[0].senha !== senha) {
            return res.status(401).json({ success: false, message: "PIN incorreto!" });
        }

        const funcId = rows[0].id;
        const agora = new Date();
        const dataHoje = agora.toISOString().split('T')[0]; 
        const horaAtual = agora.toLocaleTimeString('pt-BR', { hour12: false });

        let tipoFinal = tipo;
        if (tipo.includes("Entrada") && (agora.getHours() > 5 || (agora.getHours() === 5 && agora.getMinutes() > 55))) {
            tipoFinal = `${tipo} (⚠️ ATRASO)`;
        }

        await db.query("INSERT INTO registros_ponto (funcionario_id, data, hora, tipo) VALUES (?, ?, ?, ?)", 
            [funcId, dataHoje, horaAtual, tipoFinal]);
        
        res.json({ success: true, message: "Ponto registrado!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro ao salvar ponto." });
    }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Sansil Rodando na porta ${PORT}`);
});
