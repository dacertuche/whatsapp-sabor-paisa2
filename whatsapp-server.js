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
let isConnecting = false;

async function connectToWhatsApp() {
    if (isConnecting) {
        console.log('⚠️ Ya hay una conexión en proceso...');
        return;
    }
    
    isConnecting = true;
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false // ❗ Cambiamos a false para evitar spam en logs
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('📱 QR generado. Disponible en /qr');
                
                // Generar QR para mostrar por HTTP
                QRCode.toDataURL(qr, (err, url) => {
                    if (!err) {
                        currentQR = url;
                        console.log('✅ QR listo para escanear');
                    }
                });
            }
            
            if (connection === 'close') {
                isConnected = false;
                isConnecting = false;
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log('❌ Conexión cerrada:', statusCode);
                
                if (shouldReconnect) {
                    console.log('🔄 Reconectando en 5 segundos...');
                    // ⚠️ Esperamos 5 segundos antes de reconectar
                    setTimeout(() => {
                        connectToWhatsApp();
                    }, 5000);
                } else {
                    console.log('⚠️ Sesión cerrada. Ve a /qr para reconectar');
                    currentQR = null;
                }
            } else if (connection === 'open') {
                console.log('✅ WhatsApp conectado exitosamente');
                isConnected = true;
                isConnecting = false;
                currentQR = null;
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.key.fromMe && m.type === 'notify') {
                console.log('📩 Mensaje recibido:', msg.message?.conversation || 'Media/Other');
            }
        });
        
    } catch (error) {
        console.error('❌ Error en connectToWhatsApp:', error);
        isConnecting = false;
        
        // Reintentar después de 10 segundos si hay error
        setTimeout(() => {
            connectToWhatsApp();
        }, 10000);
    }
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
                <body style="text-align: center; padding: 50px; font-family: Arial; background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); color: white; min-height: 100vh;">
                    <h1>✅ WhatsApp Conectado</h1>
                    <p style="font-size: 1.2em;">El bot está funcionando correctamente</p>
                    <div style="margin-top: 30px;">
                        <a href="/" style="color: white; text-decoration: none; background: rgba(255,255,255,0.2); padding: 15px 30px; border-radius: 8px; display: inline-block;">Ver estado del servidor</a>
                    </div>
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
                    <h1>⏳ Generando código QR...</h1>
                    <p>El servidor se está inicializando.</p>
                    <p>Esta página se recargará automáticamente.</p>
                    <div style="margin-top: 30px;">
                        <div style="display: inline-block; width: 60px; height: 60px; border: 6px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    </div>
                    <script>
                        setTimeout(() => location.reload(), 3000);
                    </script>
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
                <title>Conectar WhatsApp - Sabor Paisa Express</title>
            </head>
            <body style="margin: 0; padding: 50px; font-family: 'Segoe UI', Arial; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; min-height: 100vh; box-sizing: border-box;">
                <div style="max-width: 600px; margin: 0 auto;">
                    <h1 style="font-size: 2.5em; margin-bottom: 10px;">📱 Conectar WhatsApp</h1>
                    <p style="font-size: 1.1em; opacity: 0.9;">Sabor Paisa Express</p>
                    
                    <div style="background: white; padding: 40px; border-radius: 20px; margin: 40px 0; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                        <img src="${currentQR}" style="width: 100%; max-width: 350px; display: block; margin: 0 auto;"/>
                    </div>
                    
                    <div style="background: rgba(255,255,255,0.15); padding: 30px; border-radius: 15px; backdrop-filter: blur(10px);">
                        <h3 style="margin-top: 0; font-size: 1.4em;">📋 Cómo conectar:</h3>
                        <ol style="text-align: left; line-height: 2.2; font-size: 1.05em; padding-left: 20px;">
                            <li>Abre <strong>WhatsApp</strong> en tu teléfono</li>
                            <li>Toca <strong>⋮</strong> o <strong>Configuración</strong></li>
                            <li>Selecciona <strong>Dispositivos vinculados</strong></li>
                            <li>Toca <strong>"Vincular dispositivo"</strong></li>
                            <li><strong>Escanea este código QR</strong> ☝️</li>
                        </ol>
                    </div>
                    
                    <p style="margin-top: 40px; opacity: 0.7; font-size: 0.9em;">
                        ⚠️ Este QR expira en 20 segundos<br>
                        La página se recargará automáticamente cada 15 segundos
                    </p>
                </div>
                
                <script>
                    // Recargar cada 15 segundos para obtener un nuevo QR
                    setTimeout(() => location.reload(), 15000);
                </script>
            </body>
        </html>
    `);
});

app.get('/', (req, res) => {
    res.json({ 
        success: true,
        status: 'online',
        whatsapp: isConnected ? 'connected' : 'disconnected',
        connecting: isConnecting,
        message: isConnected 
            ? '✅ WhatsApp conectado y funcionando' 
            : isConnecting 
                ? '🔄 Conectando a WhatsApp...'
                : '⚠️ WhatsApp desconectado. Ve a /qr para conectar',
        timestamp: new Date().toISOString(),
        qr_url: '/qr'
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        uptime: Math.floor(process.uptime()),
        whatsapp_connected: isConnected,
        timestamp: new Date().toISOString()
    });
});

app.post('/send-message', async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        if (!phone || !message) {
            return res.status(400).json({ 
                success: false,
                error: 'Faltan parámetros: phone y message son requeridos' 
            });
        }
        
        if (!sock || !isConnected) {
            return res.status(503).json({ 
                success: false,
                error: 'WhatsApp no conectado. Ve a /qr para conectar',
                qr_url: '/qr'
            });
        }

        const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        
        res.json({ 
            success: true, 
            message: 'Mensaje enviado exitosamente',
            to: phone,
            timestamp: new Date().toISOString()
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
        
        if (!groupId || !message) {
            return res.status(400).json({ 
                success: false,
                error: 'Faltan parámetros: groupId y message son requeridos' 
            });
        }
        
        if (!sock || !isConnected) {
            return res.status(503).json({ 
                success: false,
                error: 'WhatsApp no conectado. Ve a /qr para conectar',
                qr_url: '/qr'
            });
        }

        await sock.sendMessage(groupId, { text: message });
        
        res.json({ 
            success: true, 
            message: 'Mensaje enviado al grupo exitosamente',
            groupId: groupId,
            timestamp: new Date().toISOString()
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
            return res.status(503).json({ 
                success: false,
                error: 'WhatsApp no conectado. Ve a /qr primero',
                qr_url: '/qr'
            });
        }

        const groups = await sock.groupFetchAllParticipating();
        const groupList = Object.values(groups).map(g => ({
            id: g.id,
            name: g.subject,
            participants: g.participants.length,
            creation: g.creation,
            owner: g.owner
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
    console.log('═══════════════════════════════════════════════════════');
    console.log('🚀 Servidor WhatsApp - Sabor Paisa Express');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🌐 URL: https://whatsapp-sabor-paisa2.onrender.com`);
    console.log(`📱 Conectar WhatsApp: https://whatsapp-sabor-paisa2.onrender.com/qr`);
    console.log(`📊 Estado: https://whatsapp-sabor-paisa2.onrender.com/`);
    console.log(`👥 Grupos: https://whatsapp-sabor-paisa2.onrender.com/groups`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔄 Iniciando conexión a WhatsApp...');
    connectToWhatsApp();
});
