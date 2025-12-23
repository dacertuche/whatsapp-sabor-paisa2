import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import express from 'express';
import bodyParser from 'body-parser';
import QRCode from 'qrcode';
import pino from 'pino';

const app = express();
app.use(bodyParser.json());

let sock;
let currentQR = null;
let isConnected = false;
let isConnecting = false;
let qrRetries = 0;
const MAX_QR_RETRIES = 3;

// Logger silencioso para evitar spam
const logger = pino({ level: 'silent' });

async function connectToWhatsApp() {
    if (isConnecting) {
        console.log('⚠️  Ya hay una conexión en proceso...');
        return;
    }
    
    isConnecting = true;
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        const { version } = await fetchLatestBaileysVersion();
        
        sock = makeWASocket({
            auth: state,
            logger,
            version,
            printQRInTerminal: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 250,
            maxMsgRetryCount: 5,
            shouldIgnoreJid: jid => false,
            syncFullHistory: false,
            // 🔔 CONFIGURACIÓN CLAVE: No marcar como leído automáticamente
            markOnlineOnConnect: false, // No aparecer "en línea"
            emitOwnEvents: false, // No emitir eventos propios
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrRetries++;
                console.log(`📱 QR generado (${qrRetries}/${MAX_QR_RETRIES}). Disponible en /qr`);
                
                try {
                    const qrDataUrl = await QRCode.toDataURL(qr);
                    currentQR = qrDataUrl;
                    console.log('✅ QR listo para escanear - Tienes 60 segundos');
                } catch (err) {
                    console.error('❌ Error generando QR:', err);
                }
            }
            
            if (connection === 'close') {
                isConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log('❌ Conexión cerrada. Status:', statusCode);
                
                isConnecting = false;
                
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('🔓 Sesión cerrada. Escanea el QR nuevamente en /qr');
                    currentQR = null;
                    qrRetries = 0;
                    return;
                }
                
                if (statusCode === 405 || statusCode === 428) {
                    if (qrRetries >= MAX_QR_RETRIES) {
                        console.log('⚠️  Demasiados intentos. Espera 2 minutos antes de reconectar.');
                        currentQR = null;
                        qrRetries = 0;
                        setTimeout(() => {
                            console.log('🔄 Sistema listo para nueva conexión');
                        }, 120000);
                        return;
                    }
                    
                    console.log('🔄 QR expirado. Generando nuevo QR en 10 segundos...');
                    currentQR = null;
                    setTimeout(() => {
                        connectToWhatsApp();
                    }, 10000);
                    return;
                }
                
                if (shouldReconnect) {
                    console.log('🔄 Reconectando en 30 segundos...');
                    setTimeout(() => {
                        connectToWhatsApp();
                    }, 30000);
                }
            } else if (connection === 'open') {
                console.log('✅ WhatsApp conectado exitosamente');
                isConnected = true;
                isConnecting = false;
                currentQR = null;
                qrRetries = 0;
                
                // 🔔 Configurar presencia como "unavailable" para no bloquear notificaciones
                try {
                    await sock.sendPresenceUpdate('unavailable');
                    console.log('🔕 Presencia configurada como "no disponible" - Las notificaciones llegarán a tu celular');
                } catch (err) {
                    console.error('⚠️  Error configurando presencia:', err.message);
                }
            } else if (connection === 'connecting') {
                console.log('🔌 Conectando a WhatsApp...');
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // 🔔 CONFIGURACIÓN CRÍTICA: NO marcar mensajes como leídos
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            
            // Solo procesar mensajes entrantes (no los propios)
            if (!msg.key.fromMe && m.type === 'notify') {
                const text = msg.message?.conversation || 
                            msg.message?.extendedTextMessage?.text || 
                            'Media/Other';
                
                const from = msg.key.remoteJid;
                console.log('📩 Mensaje recibido de:', from);
                console.log('💬 Contenido:', text);
                
                // ❌ NO MARCAR COMO LEÍDO - Comentado para que lleguen notificaciones
                // await sock.readMessages([msg.key]);
                
                // 🔔 Mantener presencia como "unavailable"
                try {
                    await sock.sendPresenceUpdate('unavailable');
                } catch (err) {
                    // Ignorar errores de presencia
                }
                
                console.log('🔔 Mensaje NO marcado como leído - Recibirás notificación en tu celular');
            }
        });
        
        // 🔔 Mantener presencia como "unavailable" periódicamente
        setInterval(async () => {
            if (isConnected && sock) {
                try {
                    await sock.sendPresenceUpdate('unavailable');
                } catch (err) {
                    // Ignorar errores silenciosamente
                }
            }
        }, 60000); // Cada 60 segundos
        
    } catch (error) {
        console.error('❌ Error en connectToWhatsApp:', error.message);
        isConnecting = false;
        
        console.log('🔄 Reintentando en 30 segundos...');
        setTimeout(() => {
            connectToWhatsApp();
        }, 30000);
    }
}

app.get('/qr', (req, res) => {
    if (isConnected) {
        return res.send(`
            <!DOCTYPE html>
            <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>WhatsApp Conectado</title>
                </head>
                <body style="text-align: center; padding: 50px; font-family: Arial; background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); color: white; min-height: 100vh;">
                    <h1>✅ WhatsApp Conectado</h1>
                    <p style="font-size: 1.2em;">El bot está funcionando correctamente</p>
                    <div style="background: rgba(255,255,255,0.15); padding: 20px; border-radius: 10px; margin: 30px auto; max-width: 500px;">
                        <h3>🔔 Notificaciones Activas</h3>
                        <p>Los mensajes seguirán llegando como notificación a tu celular porque el bot está configurado como "no disponible"</p>
                    </div>
                    <div style="margin-top: 30px;">
                        <a href="/" style="color: white; text-decoration: none; background: rgba(255,255,255,0.2); padding: 15px 30px; border-radius: 8px; display: inline-block;">Ver estado del servidor</a>
                    </div>
                </body>
            </html>
        `);
    }
    
    if (!currentQR && !isConnecting) {
        console.log('🚀 Iniciando nueva conexión desde /qr');
        connectToWhatsApp();
    }
    
    if (!currentQR) {
        return res.send(`
            <!DOCTYPE html>
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
                        setTimeout(() => location.reload(), 5000);
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
        <!DOCTYPE html>
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
                            <li><strong>Escanea este código QR AHORA</strong> ☝️</li>
                        </ol>
                    </div>
                    
                    <div style="margin-top: 30px; padding: 20px; background: rgba(0,255,0,0.2); border-radius: 10px; border: 2px solid rgba(255,255,255,0.3);">
                        <p style="margin: 0; font-size: 1.1em; font-weight: bold;">🔔 NOTIFICACIONES ACTIVAS</p>
                        <p style="margin: 10px 0 0 0;">Este bot está configurado para NO interferir con tus notificaciones. Seguirás recibiendo alertas en tu celular de todos los mensajes.</p>
                    </div>
                    
                    <div style="margin-top: 30px; padding: 20px; background: rgba(255,0,0,0.2); border-radius: 10px; border: 2px solid rgba(255,255,255,0.3);">
                        <p style="margin: 0; font-size: 1.1em; font-weight: bold;">⚠️ IMPORTANTE</p>
                        <p style="margin: 10px 0 0 0;">Este QR expira en 60 segundos<br>
                        <strong>¡Escanéalo de inmediato!</strong><br>
                        La página NO se recargará automáticamente para darte tiempo</p>
                    </div>
                    
                    <div style="margin-top: 20px;">
                        <button onclick="location.reload()" style="background: rgba(255,255,255,0.2); border: 2px solid white; color: white; padding: 15px 30px; border-radius: 8px; cursor: pointer; font-size: 1em; font-weight: bold;">
                            🔄 Recargar para nuevo QR
                        </button>
                    </div>
                </div>
            </body>
        </html>
    `);
});

app.post('/reconnect', (req, res) => {
    if (isConnecting) {
        return res.json({ 
            success: false,
            message: 'Ya hay una conexión en proceso'
        });
    }
    
    if (isConnected) {
        return res.json({ 
            success: false,
            message: 'WhatsApp ya está conectado'
        });
    }
    
    console.log('🔄 Reconexión manual solicitada');
    qrRetries = 0;
    currentQR = null;
    connectToWhatsApp();
    
    res.json({ 
        success: true,
        message: 'Reconexión iniciada. Ve a /qr para ver el código'
    });
});

app.get('/', (req, res) => {
    res.json({ 
        success: true,
        status: 'online',
        whatsapp: isConnected ? 'connected' : 'disconnected',
        connecting: isConnecting,
        qr_retries: qrRetries,
        notifications_enabled: true,
        message: isConnected 
            ? '✅ WhatsApp conectado - Notificaciones activas en tu celular' 
            : isConnecting 
                ? '🔄 Conectando a WhatsApp... Ve a /qr'
                : '⚠️ WhatsApp desconectado. Ve a /qr para conectar',
        timestamp: new Date().toISOString(),
        qr_url: '/qr',
        reconnect_url: '/reconnect'
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        uptime: Math.floor(process.uptime()),
        whatsapp_connected: isConnected,
        whatsapp_connecting: isConnecting,
        notifications_enabled: true,
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
        
        // Volver a estado "unavailable" después de enviar
        await sock.sendPresenceUpdate('unavailable');
        
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
        
        // Volver a estado "unavailable" después de enviar
        await sock.sendPresenceUpdate('unavailable');
        
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
    console.log('🔔 NOTIFICACIONES ACTIVADAS - Los mensajes llegarán a tu celular');
    console.log('⏸️  Esperando solicitud manual en /qr para conectar');
    console.log('💡 No se conectará automáticamente al iniciar');
});
