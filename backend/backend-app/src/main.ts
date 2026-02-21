import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  // Устанавливаем глобальный префикс для всех маршрутов
  app.setGlobalPrefix('api');
  
  // Создаем папку для загрузки скинов, если её нет
  const uploadsDir = path.join(process.cwd(), 'uploads', 'skins');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  
  // Настраиваем статическую раздачу файлов из папки uploads
  app.useStaticAssets(path.join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
    setHeaders: (res) => {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    },
  });
  
  // Включаем CORS для всех запросов (включая Socket.IO)
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  
  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://0.0.0.0:${port}`);
  console.log(`API endpoints available at: http://0.0.0.0:${port}/api`);
}
bootstrap();