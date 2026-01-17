const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

// --- CONEXÃO COM O BANCO ---
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'sansil_ponto',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
}).promise(); 

// --- CONFIGURAÇÕES DE SEGURANÇA E LIMITES ---
// 1. Liberação total de CORS
app.use(cors());

// 2. Aumentar limite para fotos pesadas (ESSENCIAL PARA NÃO DAR "ERRO AO SALVAR")
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 3. Middleware "Anti-Bloqueio" do Ngrok e CORS Manual
app.use((req, res, next) => {
    res.setHeader('ngrok-skip-browser-warning', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

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
        res.json({ pontos: rows });
    } catch (err) {
        console.error("Erro ao buscar pontos:", err);
        res.status(500).json({ message: "Erro no banco de dados." });
    }
});

// Excluir funcionário
app.delete('/admin/excluir-funcionario/:nome', async (req, res) => {
    const nome = decodeURIComponent(req.params.nome);
    try {
        await db.query("DELETE FROM funcionarios WHERE nome = ?", [nome]);
        res.json({ message: "Funcionário excluído com sucesso!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro ao excluir." });
    }
});

// Cadastrar ou Editar Funcionário (LÓGICA DA FOTO CORRIGIDA)
app.post('/admin/cadastrar-funcionario', async (req, res) => {
    const { id, nome, turnoAlmoco, diasTrabalho, foto_perfil, id_biometria } = req.body;
    
    try {
        // Se a foto vier vazia ou for muito curta (não for um base64 real), vira null
        const fotoValida = (foto_perfil && foto_perfil.length > 100) ? foto_perfil : null;

        if (id) {
            // EDIÇÃO: Só troca a foto se fotoValida não for null (graças ao COALESCE)
            const sqlUpdate = `
                UPDATE funcionarios 
                SET nome = ?, horario_almoco = ?, dias_trabalho = ?, 
                    foto_perfil = COALESCE(?, foto_perfil), id_biometria = ? 
                WHERE id = ?`;
            await db.query(sqlUpdate, [nome, turnoAlmoco, diasTrabalho, fotoValida, id_biometria, id]);
            res.json({ message: "Dados atualizados com sucesso!" });
        } else {
            // NOVO CADASTRO
            const sqlInsert = "INSERT INTO funcionarios (nome, horario_almoco, dias_trabalho, foto_perfil, id_biometria) VALUES (?, ?, ?, ?, ?)";
            await db.query(sqlInsert, [nome, turnoAlmoco, diasTrabalho, fotoValida, id_biometria]);
            res.json({ message: "Funcionário cadastrado com sucesso!" });
        }
    } catch (err) {
        console.error("ERRO CRÍTICO NO BANCO:", err);
        res.status(500).json({ message: "Erro interno: " + err.message });
    }
});

// Listar Equipe
app.get('/admin/equipe', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, nome, horario_almoco, dias_trabalho, foto_perfil, id_biometria FROM funcionarios");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: "Erro ao buscar equipe." });
    }
});

// --- REGISTRO DE PONTO ---
app.post('/bater-ponto', async (req, res) => {
    const { funcionario, tipo, foto } = req.body;
    try {
        const [result] = await db.query("SELECT id FROM funcionarios WHERE nome = ?", [funcionario]);
        if (result.length === 0) return res.status(404).json({ message: "Funcionário não encontrado." });
        
        const funcId = result[0].id;
        const agora = new Date();
        const dataHoje = agora.toLocaleDateString('en-CA'); 
        const horaAtual = agora.toLocaleTimeString('pt-BR', { hour12: false });

        let tipoFinal = tipo;
        // Regra de atraso: após 05:55
        if (tipo.includes("Entrada") && (agora.getHours() > 5 || (agora.getHours() === 5 && agora.getMinutes() > 55))) {
            tipoFinal = `${tipo} (⚠️ ATRASO)`;
        }

        const [resPonto] = await db.query("INSERT INTO registros_ponto (funcionario_id, data, hora, tipo) VALUES (?, ?, ?, ?)", 
            [funcId, dataHoje, horaAtual, tipoFinal]);

        if (foto) {
            await db.query("INSERT INTO fotos_registros (registro_id, foto_batida) VALUES (?, ?)", [resPonto.insertId, foto]);
        }

        res.json({ message: "Ponto registrado com sucesso!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erro ao salvar ponto." });
    }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

// --- INICIALIZAÇÃO ---
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    --------------------------------------------------
    🚀 SANSIL PONTO RODANDO NA PORTA ${PORT}
    📡 ACESSE PELO HTTPS DO NGROK PARA A CÂMERA FUNCIONAR
    --------------------------------------------------
    `);
});