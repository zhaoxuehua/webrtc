"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
async function bootstrap() {
    let httpsOptions = undefined;
    if (process.env.USE_HTTPS === 'true') {
        try {
            httpsOptions = {
                key: fs.readFileSync(path.join(__dirname, '..', 'secrets', 'key.pem')),
                cert: fs.readFileSync(path.join(__dirname, '..', 'secrets', 'cert.pem')),
            };
            console.log('启动模式: HTTPS (强制加密)');
        }
        catch (e) {
            console.warn('警告：无法读取 SSL 证书，将回退到 HTTP 模式', e.message);
        }
    }
    else {
        console.log('启动模式: HTTP (由 Nginx 负责外部 HTTPS)');
    }
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        ...(httpsOptions ? { httpsOptions } : {}),
    });
    const port = process.env.PORT ?? 3000;
    await app.listen(port);
    console.log(`Application is running on: ${httpsOptions ? 'https' : 'http'}://localhost:${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map