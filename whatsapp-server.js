const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const bodyParser = require('body-parser');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(bodyParser.json());

let sock;
let qrGenerated = false;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr && !qrGenerated) {
            console.log('📱 Escanea este QR con WhatsApp:');
            qrcode.generate(qr, { small: true });
            qrGenerated = true;
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Conectado a WhatsApp');
            qrGenerated = false;
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Recibir mensajes
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            console.log('📩 Mensaje recibido:', msg.message?.conversation);
            // Aquí puedes enviar a n8n si quieres procesar pedidos por WhatsApp
        }
    });
}

// API para enviar mensajes
app.post('/send-message', async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        if (!sock) {
            return res.status(400).json({ error: 'WhatsApp no conectado' });
        }

        // Formato: 573001234567@s.whatsapp.net
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
        
        if (!sock) {
            return res.status(400).json({ error: 'WhatsApp no conectado' });
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
        if (!sock) {
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

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor WhatsApp corriendo en http://localhost:${PORT}`);
    connectToWhatsApp();
});