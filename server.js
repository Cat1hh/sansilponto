const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const app = express();

// --- CONEXÃO COM O BANCO DE DADOS (MySQL Railway) ---
const db = mysql.createPool({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER || 'root',
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '-03:00' // Força o fuso horário de Brasília no MySQL
});

// Inicialização das tabelas
async function initDb() {
    try {
        await db.query(`CREATE TABLE IF NOT EXISTS funcionarios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(255) NOT NULL,
            horario_almoco VARCHAR(50),
            dias_trabalho VARCHAR(255),
            foto_perfil LONGTEXT,
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
        await db.query(`CREATE TABLE IF NOT EXISTS fotos_registros (
            id INT AUTO_INCREMENT PRIMARY KEY,
            registro_id INT,
            foto_batida LONGTEXT,
            FOREIGN KEY(registro_id) REFERENCES registros_ponto(id) ON DELETE CASCADE
        )`);
        console.log("✅ Tabelas MySQL prontas!");
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

// Listar todos os pontos
app.get('/admin/pontos', async (req, res) => {
    try {
        const sql = `
            SELECT f.nome as funcionario, r.data, r.hora, r.tipo 
            FROM registros_ponto r 
            JOIN funcionarios f ON r.funcionario_id = f.id 
            ORDER BY r.data DESC, r.hora DESC`;
        const [rows] = await db.query(sql);
        res.json({ pontos: rows, diasRestantes: 30 }); // Exemplo de contagem de dias
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Cadastrar ou Editar Funcionário
app.post('/admin/cadastrar-funcionario', async (req, res) => {
    const { id, nome, turnoAlmoco, diasTrabalho, foto_perfil, id_biometria } = req.body;
    
    try {
        if (id) {
            // Se houver foto nova, atualiza. Se não, mantém a antiga.
            const sqlUpdate = `
                UPDATE funcionarios 
                SET nome = ?, horario_almoco = ?, dias_trabalho = ?, 
                    foto_perfil = COALESCE(?, foto_perfil), id_biometria = ? 
                WHERE id = ?`;
            await db.query(sqlUpdate, [nome, turnoAlmoco, diasTrabalho, foto_perfil || null, id_biometria, id]);
            res.json({ message: "Funcionário atualizado!" });
        } else {
            const sqlInsert = "INSERT INTO funcionarios (nome, horario_almoco, dias_trabalho, foto_perfil, id_biometria) VALUES (?, ?, ?, ?, ?)";
            await db.query(sqlInsert, [nome, turnoAlmoco, diasTrabalho, foto_perfil, id_biometria]);
            res.json({ message: "Cadastrado com sucesso!" });
        }
    } catch (err) {
        res.status(500).json({ message: "Erro no banco de dados." });
    }
});

// Listar Equipe
app.get('/admin/equipe', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM funcionarios ORDER BY nome ASC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Excluir Funcionário
app.delete('/admin/excluir-funcionario/:nome', async (req, res) => {
    const nome = decodeURIComponent(req.params.nome);
    try {
        await db.query("DELETE FROM funcionarios WHERE nome = ?", [nome]);
        res.json({ message: "Excluído!" });
    } catch (err) {
        res.status(500).json({ message: "Erro ao excluir." });
    }
});

// --- REGISTRO DE PONTO (USADO PELO FRONT-END) ---
app.post('/bater-ponto', async (req, res) => {
    const { funcionario, tipo, foto } = req.body;
    
    try {
        const [rows] = await db.query("SELECT id FROM funcionarios WHERE nome = ?", [funcionario]);
        if (rows.length === 0) return res.status(404).json({ message: "Funcionário não existe." });
        
        const funcId = rows[0].id;

        // Garantir Data e Hora no fuso de Brasília (GMT-3)
        const agora = new Date();
        const dataBrasilia = new Date(agora.getTime() - (3 * 60 * 60 * 1000));
        const dataHoje = dataBrasilia.toISOString().split('T')[0];
        const horaAtual = agora.toLocaleTimeString('pt-BR', { hour12: false });

        let tipoFinal = tipo;
        // Lógica de atraso (Exemplo: se for entrada e passar das 05:55)
        if (tipo.toLowerCase().includes("entrada")) {
            const [horas, minutos] = horaAtual.split(':').map(Number);
            if (horas > 5 || (horas === 5 && minutos > 55)) {
                tipoFinal += " (⚠️ ATRASO)";
            }
        }

        const [result] = await db.query(
            "INSERT INTO registros_ponto (funcionario_id, data, hora, tipo) VALUES (?, ?, ?, ?)", 
            [funcId, dataHoje, horaAtual, tipoFinal]
        );
        
        if (foto) {
            await db.query("INSERT INTO fotos_registros (registro_id, foto_batida) VALUES (?, ?)", [result.insertId, foto]);
        }

        res.json({ message: "Ponto batido!", hora: horaAtual });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro ao salvar no servidor." });
    }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Sansil Rodando na porta ${PORT}`);
});
