const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose(); // Trocado MySQL por SQLite para o Railway
const app = express();

// --- CONFIGURAÇÃO DO BANCO DE DADOS (SQLite) ---
// O Railway criará esse arquivo automaticamente no servidor
const dbFile = path.resolve(__dirname, 'sansil_ponto.db');
const db = new sqlite3.Database(dbFile);

// Inicialização das tabelas (Equivalente ao seu banco MySQL)
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS funcionarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        horario_almoco TEXT,
        dias_trabalho TEXT,
        foto_perfil TEXT,
        id_biometria TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS registros_ponto (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        funcionario_id INTEGER,
        data TEXT,
        hora TEXT,
        tipo TEXT,
        FOREIGN KEY(funcionario_id) REFERENCES funcionarios(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS fotos_registros (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        registro_id INTEGER,
        foto_batida TEXT,
        FOREIGN KEY(registro_id) REFERENCES registros_ponto(id)
    )`);
});

// --- CONFIGURAÇÕES DE SEGURANÇA E LIMITES ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(__dirname)); 

// --- ROTAS ADMINISTRATIVAS ---

// Listar todos os pontos
app.get('/admin/pontos', (req, res) => {
    const sql = `
        SELECT f.nome as funcionario, r.data, r.hora, r.tipo 
        FROM registros_ponto r 
        JOIN funcionarios f ON r.funcionario_id = f.id 
        ORDER BY r.data DESC, r.hora DESC`;
    
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json({ pontos: rows });
    });
});

// Excluir funcionário
app.delete('/admin/excluir-funcionario/:nome', (req, res) => {
    const nome = decodeURIComponent(req.params.nome);
    db.run("DELETE FROM funcionarios WHERE nome = ?", [nome], (err) => {
        if (err) return res.status(500).json({ message: "Erro ao excluir." });
        res.json({ message: "Funcionário excluído com sucesso!" });
    });
});

// Cadastrar ou Editar Funcionário
app.post('/admin/cadastrar-funcionario', (req, res) => {
    const { id, nome, turnoAlmoco, diasTrabalho, foto_perfil, id_biometria } = req.body;
    const fotoValida = (foto_perfil && foto_perfil.length > 100) ? foto_perfil : null;

    if (id) {
        // EDIÇÃO (Usando logicamente o COALESCE do SQLite)
        const sqlUpdate = `
            UPDATE funcionarios 
            SET nome = ?, horario_almoco = ?, dias_trabalho = ?, 
                foto_perfil = IFNULL(?, foto_perfil), id_biometria = ? 
            WHERE id = ?`;
        db.run(sqlUpdate, [nome, turnoAlmoco, diasTrabalho, fotoValida, id_biometria, id], (err) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json({ message: "Dados atualizados com sucesso!" });
        });
    } else {
        // NOVO CADASTRO
        const sqlInsert = "INSERT INTO funcionarios (nome, horario_almoco, dias_trabalho, foto_perfil, id_biometria) VALUES (?, ?, ?, ?, ?)";
        db.run(sqlInsert, [nome, turnoAlmoco, diasTrabalho, fotoValida, id_biometria], (err) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json({ message: "Funcionário cadastrado com sucesso!" });
        });
    }
});

// Listar Equipe
app.get('/admin/equipe', (req, res) => {
    db.all("SELECT id, nome, horario_almoco, dias_trabalho, foto_perfil, id_biometria FROM funcionarios", [], (err, rows) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json(rows);
    });
});

// --- REGISTRO DE PONTO ---
app.post('/bater-ponto', (req, res) => {
    const { funcionario, tipo, foto } = req.body;
    
    db.get("SELECT id FROM funcionarios WHERE nome = ?", [funcionario], (err, row) => {
        if (err || !row) return res.status(404).json({ message: "Funcionário não encontrado." });
        
        const funcId = row.id;
        const agora = new Date();
        const dataHoje = agora.toLocaleDateString('en-CA'); 
        const horaAtual = agora.toLocaleTimeString('pt-BR', { hour12: false });

        let tipoFinal = tipo;
        // Sua regra de atraso Sansil: após 05:55
        if (tipo.includes("Entrada") && (agora.getHours() > 5 || (agora.getHours() === 5 && agora.getMinutes() > 55))) {
            tipoFinal = `${tipo} (⚠️ ATRASO)`;
        }

        db.run("INSERT INTO registros_ponto (funcionario_id, data, hora, tipo) VALUES (?, ?, ?, ?)", 
            [funcId, dataHoje, horaAtual, tipoFinal], function(err) {
                if (err) return res.status(500).json({ message: "Erro ao salvar ponto." });
                
                const lastId = this.lastID;
                if (foto) {
                    db.run("INSERT INTO fotos_registros (registro_id, foto_batida) VALUES (?, ?)", [lastId, foto]);
                }
                res.json({ message: "Ponto registrado com sucesso!" });
        });
    });
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

// --- INICIALIZAÇÃO PARA RAILWAY ---
const PORT = process.env.PORT || 3000; // Railway define a porta automaticamente
app.listen(PORT, () => {
    console.log(`🚀 Servidor Sansil Rodando na porta ${PORT}`);
});