import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import express from 'express';
import bodyParser from 'body-parser';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';

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
            
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) {
                    currentQR = url;
                }
            });
        }
        
        if (connection === 'close') {
            isConnected = false;

            const statusCode = lastDisconnect?.error?.output?.statusCode;

            // ⚠️ NO reconectar si está esperando QR (401)
            const shouldReconnect =
                statusCode !== DisconnectReason.loggedOut &&
                statusCode !== 401;

            console.log('Conexión cerrada. Reconectando...', shouldReconnect);

            if (shouldReconnect) {
                connectToWhatsApp();
            }
        
        } else if (connection === 'open') {
            console.log('✅ Conectado a WhatsApp');
            isConnected = true;
            currentQR = null;
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

app.get('/qr', (req, res) => {
    if (isConnected) {
        return res.send(`
            <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>WhatsApp Conectado</title>
                </head>
                <body style="text-align: center; padding: 50px; font-family: Arial; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; min-height: 100vh;">
                    <h1>✅ WhatsApp ya está conectado</h1>
                    <p>No es necesario escanear ningún QR.</p>
                    <p style="margin-top: 30px;">
                        <a href="/" style="color: white; text-decoration: none; background: rgba(255,255,255,0.2); padding: 10px 20px; border-radius: 5px;">Ver estado</a>
                    </p>
                </body>
            </html>
        `);
    }
    
    if (!currentQR) {
        return res.send(`
            <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Esperando QR</title>
                </head>
                <body style="text-align: center; padding: 50px; font-family: Arial; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; min-height: 100vh;">
                    <h1>⏳ Esperando QR...</h1>
                    <p>El servidor se está inicializando. Recarga esta página en unos segundos.</p>
                    <div style="margin-top: 30px;">
                        <div style="display: inline-block; width: 50px; height: 50px; border: 5px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    </div>
                    <script>setTimeout(() => location.reload(), 3000);</script>
                    <style>
                        @keyframes spin {
                            to { transform: rotate(360deg); }
                        }
                    </style>
                </body>
            </html>
        `);
    }
    
    res.send(`
        <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Conectar WhatsApp</title>
            </head>
            <body style="text-align: center; padding: 50px; font-family: Arial; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; min-height: 100vh;">
                <h1>📱 Escanea este QR con WhatsApp</h1>
                <div style="background: white; display: inline-block; padding: 30px; border-radius: 20px; margin: 30px 0; box-shadow: 0 10px 40px rgba(0,0,0,0.3);">
                    <img src="${currentQR}" style="max-width: 300px; display: block;"/>
                </div>
                <div style="max-width: 500px; margin: 0 auto; background: rgba(255,255,255,0.1); padding: 30px; border-radius: 15px;">
                    <h3 style="margin-bottom: 20px;">📋 Instrucciones:</h3>
                    <ol style="text-align: left; line-height: 2;">
                        <li>Abre <strong>WhatsApp</strong> en tu celular</li>
                        <li>Ve a <strong>Configuración → Dispositivos vinculados</strong></li>
                        <li>Toca <strong>"Vincular dispositivo"</strong></li>
                        <li>Escanea este código QR</li>
                    </ol>
                </div>
                <p style="margin-top: 30px; opacity: 0.8;">
                    <small>Esta página se recargará automáticamente cada 10 segundos</small>
                </p>
                <script>setTimeout(() => location.reload(), 10000);</script>
            </body>
        </html>
    `);
});

app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        whatsapp: isConnected ? 'connected' : 'disconnected',
        message: isConnected ? 'WhatsApp conectado ✅' : 'WhatsApp desconectado. Ve a /qr para conectar 📱',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.post('/send-message', async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        if (!sock || !isConnected) {
            return res.status(400).json({ 
                success: false,
                error: 'WhatsApp no conectado. Ve a /qr para conectar' 
            });
        }

        const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        
        res.json({ 
            success: true, 
            message: 'Mensaje enviado exitosamente',
            to: phone 
        });
    } catch (error) {
        console.error('❌ Error enviando mensaje:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

app.post('/send-to-group', async (req, res) => {
    try {
        const { groupId, message } = req.body;
        
        if (!sock || !isConnected) {
            return res.status(400).json({ 
                success: false,
                error: 'WhatsApp no conectado. Ve a /qr para conectar' 
            });
        }

        await sock.sendMessage(groupId, { text: message });
        
        res.json({ 
            success: true, 
            message: 'Mensaje enviado al grupo exitosamente',
            groupId: groupId 
        });
    } catch (error) {
        console.error('❌ Error enviando al grupo:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

app.get('/groups', async (req, res) => {
    try {
        if (!sock || !isConnected) {
            return res.status(400).json({ 
                success: false,
                error: 'WhatsApp no conectado. Ve a /qr primero' 
            });
        }

        const groups = await sock.groupFetchAllParticipating();
        const groupList = Object.values(groups).map(g => ({
            id: g.id,
            name: g.subject,
            participants: g.participants.length
        }));
        
        res.json({
            success: true,
            count: groupList.length,
            groups: groupList
        });
    } catch (error) {
        console.error('❌ Error obteniendo grupos:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor WhatsApp corriendo en puerto ${PORT}`);
    console.log(`📱 Para conectar WhatsApp, ve a: /qr`);
    console.log(`📊 Estado del servidor: /`);
    console.log(`👥 Ver grupos: /groups`);
    connectToWhatsApp();
});
