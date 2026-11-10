// Test-only bootstrap: fail before opening any network connection or listener.
import net from 'node:net';import tls from 'node:tls';import http from 'node:http';import https from 'node:https';import http2 from 'node:http2';import dgram from 'node:dgram';import {syncBuiltinESMExports} from 'node:module';
const denied=()=>{throw new Error('network_forbidden_in_recovery_tests');};
globalThis.fetch=denied;net.connect=denied;net.createConnection=denied;net.Socket.prototype.connect=denied;net.Server.prototype.listen=denied;tls.connect=denied;
http.request=denied;http.get=denied;https.request=denied;https.get=denied;http2.connect=denied;dgram.createSocket=denied;syncBuiltinESMExports();
