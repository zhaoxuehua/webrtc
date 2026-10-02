import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  let httpsOptions: any = undefined;
  
  // 仅当 USE_HTTPS 环境变量为 true 时才启用 HTTPS (开发环境)
  if (process.env.USE_HTTPS === 'true') {
    try {
      httpsOptions = {
        key: fs.readFileSync(path.join(__dirname, '..', 'secrets', 'key.pem')),
        cert: fs.readFileSync(path.join(__dirname, '..', 'secrets', 'cert.pem')),
      };
      console.log('启动模式: HTTPS (强制加密)');
    } catch (e) {
      console.warn('警告：无法读取 SSL 证书，将回退到 HTTP 模式', e.message);
    }
  } else {
    console.log('启动模式: HTTP (由 Nginx 负责外部 HTTPS)');
  }

  // 使用展开运算符，只有当 httpsOptions 有值时才传入
  const app = await NestFactory.create(AppModule, {
    ...(httpsOptions ? { httpsOptions } : {}),
  });
  
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Application is running on: ${httpsOptions ? 'https' : 'http'}://localhost:${port}`);
}
bootstrap();

