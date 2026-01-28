const express = require('express');
const mysql = require('mysql2/promise'); // Mudamos para mysql2
const cors = require('cors');
const path = require('path');
const app = express();

// --- CONEXÃO COM O BANCO DE DADOS (MySQL Railway) ---
// O pool de conexão usa as variáveis que você viu na tela do Railway
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

// Inicialização das tabelas no MySQL
async function initDb() {
    try {
        await db.query(`CREATE TABLE IF NOT EXISTS funcionarios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(255),
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
            FOREIGN KEY(funcionario_id) REFERENCES funcionarios(id)
        )`);
        await db.query(`CREATE TABLE IF NOT EXISTS fotos_registros (
            id INT AUTO_INCREMENT PRIMARY KEY,
            registro_id INT,
            foto_batida LONGTEXT,
            FOREIGN KEY(registro_id) REFERENCES registros_ponto(id)
        )`);
        console.log("✅ Tabelas MySQL prontas e persistentes!");
    } catch (err) {
        console.error("❌ Erro ao criar tabelas:", err);
    }
}
initDb();

// --- CONFIGURAÇÕES DE SEGURANÇA ---
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
        await db.query("DELETE FROM funcionarios WHERE nome = ?", [nome]);
        res.json({ message: "Funcionário excluído com sucesso!" });
    } catch (err) {
        res.status(500).json({ message: "Erro ao excluir." });
    }
});

app.post('/admin/cadastrar-funcionario', async (req, res) => {
    const { id, nome, turnoAlmoco, diasTrabalho, foto_perfil, id_biometria } = req.body;
    const fotoValida = (foto_perfil && foto_perfil.length > 100) ? foto_perfil : null;

    try {
        if (id) {
            const sqlUpdate = `
                UPDATE funcionarios 
                SET nome = ?, horario_almoco = ?, dias_trabalho = ?, 
                    foto_perfil = IFNULL(?, foto_perfil), id_biometria = ? 
                WHERE id = ?`;
            await db.query(sqlUpdate, [nome, turnoAlmoco, diasTrabalho, fotoValida, id_biometria, id]);
            res.json({ message: "Dados atualizados com sucesso!" });
        } else {
            const sqlInsert = "INSERT INTO funcionarios (nome, horario_almoco, dias_trabalho, foto_perfil, id_biometria) VALUES (?, ?, ?, ?, ?)";
            await db.query(sqlInsert, [nome, turnoAlmoco, diasTrabalho, fotoValida, id_biometria]);
            res.json({ message: "Funcionário cadastrado com sucesso!" });
        }
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/admin/equipe', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, nome, horario_almoco, dias_trabalho, foto_perfil, id_biometria FROM funcionarios");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --- REGISTRO DE PONTO ---
app.post('/bater-ponto', async (req, res) => {
    const { funcionario, tipo, foto } = req.body;
    
    try {
        const [rows] = await db.query("SELECT id FROM funcionarios WHERE nome = ?", [funcionario]);
        if (rows.length === 0) return res.status(404).json({ message: "Funcionário não encontrado." });
        
        const funcId = rows[0].id;
        const agora = new Date();
        const dataHoje = agora.toISOString().split('T')[0]; 
        const horaAtual = agora.toLocaleTimeString('pt-BR', { hour12: false });

        let tipoFinal = tipo;
        if (tipo.includes("Entrada") && (agora.getHours() > 5 || (agora.getHours() === 5 && agora.getMinutes() > 55))) {
            tipoFinal = `${tipo} (⚠️ ATRASO)`;
        }

        const [result] = await db.query("INSERT INTO registros_ponto (funcionario_id, data, hora, tipo) VALUES (?, ?, ?, ?)", 
            [funcId, dataHoje, horaAtual, tipoFinal]);
        
        if (foto) {
            await db.query("INSERT INTO fotos_registros (registro_id, foto_batida) VALUES (?, ?)", [result.insertId, foto]);
        }
        res.json({ message: "Ponto registrado com sucesso!" });
    } catch (err) {
        res.status(500).json({ message: "Erro ao salvar ponto." });
    }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Sansil Rodando na porta ${PORT}`);
});
