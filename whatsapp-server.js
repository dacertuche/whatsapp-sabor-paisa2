const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const bodyParser = require('body-parser');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');

const app = express();
app.use(bodyParser.json());

let sock;
let currentQR = null;
let isConnected = false;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('📱 QR generado. Ve a /qr para escanearlo');
            qrcode.generate(qr, { small: true });
            
            // Guardar QR como imagen para mostrarlo por HTTP
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) {
                    currentQR = url;
                }
            });
        }
        
        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Conectado a WhatsApp');
            isConnected = true;
            currentQR = null; // Limpiar QR cuando se conecta
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            console.log('📩 Mensaje recibido:', msg.message?.conversation);
        }
    });
}

// Endpoint para ver el QR
app.get('/qr', (req, res) => {
    if (isConnected) {
        return res.send(`
            <html>
                <body style="text-align: center; padding: 50px; font-family: Arial;">
                    <h1>✅ WhatsApp ya está conectado</h1>
                    <p>No es necesario escanear ningún QR.</p>
                </body>
            </html>
        `);
    }
    
    if (!currentQR) {
        return res.send(`
            <html>
                <body style="text-align: center; padding: 50px; font-family: Arial;">
                    <h1>⏳ Esperando QR...</h1>
                    <p>El servidor se está inicializando. Recarga esta página en unos segundos.</p>
                    <script>setTimeout(() => location.reload(), 3000);</script>
                </body>
            </html>
        `);
    }
    
    res.send(`
        <html>
            <body style="text-align: center; padding: 50px; font-family: Arial;">
                <h1>📱 Escanea este QR con WhatsApp</h1>
                <img src="${currentQR}" style="max-width: 400px; border: 2px solid #25D366; padding: 20px; border-radius: 10px;"/>
                <p style="max-width: 400px; margin: 20px auto;">
                    <strong>Pasos:</strong><br>
                    1. Abre WhatsApp en tu celular<br>
                    2. Ve a Configuración → Dispositivos vinculados<br>
                    3. Toca "Vincular dispositivo"<br>
                    4. Escanea este código QR
                </p>
                <script>setTimeout(() => location.reload(), 10000);</script>
            </body>
        </html>
    `);
});

// Endpoint de estado
app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        whatsapp: isConnected ? 'connected' : 'disconnected',
        message: isConnected ? 'WhatsApp conectado' : 'WhatsApp desconectado. Ve a /qr para conectar'
    });
});

// API para enviar mensajes
app.post('/send-message', async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        if (!sock || !isConnected) {
            return res.status(400).json({ error: 'WhatsApp no conectado. Ve a /qr' });
        }

        const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
        
        await sock.sendMessage(jid, { text: message });
        
        res.json({ success: true, message: 'Mensaje enviado' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API para enviar a grupo
app.post('/send-to-group', async (req, res) => {
    try {
        const { groupId, message } = req.body;
        
        if (!sock || !isConnected) {
            return res.status(400).json({ error: 'WhatsApp no conectado. Ve a /qr' });
        }

        await sock.sendMessage(groupId, { text: message });
        
        res.json({ success: true, message: 'Mensaje enviado al grupo' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener grupos
app.get('/groups', async (req, res) => {
    try {
        if (!sock || !isConnected) {
            return res.status(400).json({ error: 'WhatsApp no conectado' });
        }

        const groups = await sock.groupFetchAllParticipating();
        const groupList = Object.values(groups).map(g => ({
            id: g.id,
            name: g.subject,
            participants: g.participants.length
        }));
        
        res.json(groupList);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor WhatsApp corriendo en puerto ${PORT}`);
    console.log(`📱 Para conectar WhatsApp, ve a: /qr`);
    connectToWhatsApp();
});