const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const app = express();

// --- CONEXÃO COM O BANCO DE DADOS (Railway) ---
const db = mysql.createPool({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER || 'root',
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '-03:00' // Ajusta para o fuso horário de Brasília
});

// Inicialização das tabelas
async function initDb() {
    try {
        // Tabela de funcionários com a nova coluna 'senha'
        await db.query(`CREATE TABLE IF NOT EXISTS funcionarios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(255) NOT NULL,
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
        
        console.log("✅ Banco de Dados sincronizado (Sistema de Senha)");
    } catch (err) {
        console.error("❌ Erro ao iniciar banco:", err);
    }
}
initDb();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname)); 

// --- ROTAS ADMINISTRATIVAS ---

// Listar Equipe (agora retorna a senha para validação no front)
app.get('/admin/equipe', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, nome, senha, horario_almoco, dias_trabalho, id_biometria FROM funcionarios ORDER BY nome ASC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Cadastrar ou Editar Funcionário (incluindo senha)
app.post('/admin/cadastrar-funcionario', async (req, res) => {
    const { id, nome, senha, turnoAlmoco, diasTrabalho, id_biometria } = req.body;
    try {
        if (id) {
            const sqlUpdate = `UPDATE funcionarios SET nome=?, senha=?, horario_almoco=?, dias_trabalho=?, id_biometria=? WHERE id=?`;
            await db.query(sqlUpdate, [nome, senha, turnoAlmoco, diasTrabalho, id_biometria, id]);
            res.json({ message: "Atualizado com sucesso!" });
        } else {
            const sqlInsert = "INSERT INTO funcionarios (nome, senha, horario_almoco, dias_trabalho, id_biometria) VALUES (?, ?, ?, ?, ?)";
            await db.query(sqlInsert, [nome, senha || '1234', turnoAlmoco, diasTrabalho, id_biometria]);
            res.json({ message: "Cadastrado com sucesso!" });
        }
    } catch (err) {
        res.status(500).json({ message: "Erro ao salvar funcionário." });
    }
});

// --- REGISTRO DE PONTO ---
app.post('/bater-ponto', async (req, res) => {
    const { funcionario, tipo } = req.body;
    
    try {
        const [rows] = await db.query("SELECT id FROM funcionarios WHERE nome = ?", [funcionario]);
        if (rows.length === 0) return res.status(404).json({ message: "Funcionário não encontrado." });
        
        const funcId = rows[0].id;
        
        // Data e Hora ajustadas para o fuso do Brasil
        const agora = new Date();
        const dataHoje = new Date(agora.getTime() - (3 * 60 * 60 * 1000)).toISOString().split('T')[0];
        const horaAtual = agora.toLocaleTimeString('pt-BR', { hour12: false });

        let tipoFinal = tipo;
        // Lógica de atraso (exemplo 05:55)
        const [h, m] = horaAtual.split(':').map(Number);
        if (tipo.includes("Entrada") && (h > 5 || (h === 5 && m > 55))) {
            tipoFinal += " (⚠️ ATRASO)";
        }

        await db.query("INSERT INTO registros_ponto (funcionario_id, data, hora, tipo) VALUES (?, ?, ?, ?)", 
            [funcId, dataHoje, horaAtual, tipoFinal]);
        
        res.json({ message: "Ponto registrado!", hora: horaAtual });
    } catch (err) {
        res.status(500).json({ message: "Erro ao processar ponto." });
    }
});

app.get('/admin/pontos', async (req, res) => {
    try {
        const sql = `
            SELECT f.nome as funcionario, r.data, r.hora, r.tipo 
            FROM registros_ponto r 
            JOIN funcionarios f ON r.funcionario_id = f.id 
            ORDER BY r.data DESC, r.hora DESC LIMIT 500`;
        const [rows] = await db.query(sql);
        res.json({ pontos: rows });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.delete('/admin/excluir-funcionario/:nome', async (req, res) => {
    const nome = decodeURIComponent(req.params.nome);
    try {
        await db.query("DELETE FROM funcionarios WHERE nome = ?", [nome]);
        res.json({ message: "Excluído!" });
    } catch (err) {
        res.status(500).json({ message: "Erro ao excluir." });
    }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Sansil Rodando na porta ${PORT}`);
});
