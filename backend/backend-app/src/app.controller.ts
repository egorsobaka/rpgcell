import { Body, Controller, Delete, Get, Param, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppService } from './app.service';
import { GameService } from './game.service';
import * as fs from 'fs';
import * as path from 'path';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly gameService: GameService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Delete('players')
  async removeAllPlayers(): Promise<{ deletedCount: number; message: string }> {
    const result = await this.gameService.removeAllPlayers();
    return {
      ...result,
      message: `Удалено игроков: ${result.deletedCount}`,
    };
  }

  // Альтернативный эндпоинт через POST (на случай проблем с DELETE)
  @Post('players/delete-all')
  async removeAllPlayersPost(): Promise<{ deletedCount: number; message: string }> {
    const result = await this.gameService.removeAllPlayers();
    return {
      ...result,
      message: `Удалено игроков: ${result.deletedCount}`,
    };
  }

  // Перегенерировать карту (удалить все клетки)
  @Post('map/regenerate')
  async regenerateMap(): Promise<{ deletedCount: number; message: string }> {
    const result = await this.gameService.regenerateMap();
    return {
      ...result,
      message: `Удалено клеток: ${result.deletedCount}. Карта будет перегенерирована при следующем обращении к клеткам.`,
    };
  }

  // Альтернативный эндпоинт через DELETE
  @Delete('map')
  async regenerateMapDelete(): Promise<{ deletedCount: number; message: string }> {
    const result = await this.gameService.regenerateMap();
    return {
      ...result,
      message: `Удалено клеток: ${result.deletedCount}. Карта будет перегенерирована при следующем обращении к клеткам.`,
    };
  }

  @Get('players')
  async getPlayers(): Promise<{ players: any[]; count: number }> {
    const players = await this.gameService.getPlayers();
    return {
      players: players.map(p => ({
        id: p.id,
        name: p.name,
        position: p.position,
        level: p.level,
        experience: p.experience,
        totalCollected: p.totalCollected,
        satiety: p.satiety,
        weight: p.weight,
        stamina: p.stamina,
        collectionPower: p.collectionPower,
        power: p.power,
        health: p.health,
        maxHealth: p.maxHealth,
        defense: p.defense,
        luck: p.luck,
        regeneration: p.regeneration,
        inventory: p.inventory,
        unlockedColors: p.unlockedColors,
      })),
      count: players.length,
    };
  }

  // Установить параметр персонажа по ID
  @Put('players/:playerId/parameter/:parameter')
  async setPlayerParameter(
    @Param('playerId') playerId: string,
    @Param('parameter') parameter: string,
    @Body() body: { value: any },
  ): Promise<{ success: boolean; message?: string; player?: any }> {
    const result = await this.gameService.updatePlayerParameter(playerId, parameter, body.value);
    return result;
  }

  // Альтернативный эндпоинт через POST
  @Post('players/:playerId/parameter/:parameter')
  async setPlayerParameterPost(
    @Param('playerId') playerId: string,
    @Param('parameter') parameter: string,
    @Body() body: { value: any },
  ): Promise<{ success: boolean; message?: string; player?: any }> {
    const result = await this.gameService.updatePlayerParameter(playerId, parameter, body.value);
    return result;
  }

  // Загрузить скин для персонажа
  @Post('players/:playerId/skin')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSkin(
    @Param('playerId') playerId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ success: boolean; message?: string; skinUrl?: string; player?: any }> {
    if (!file) {
      return { success: false, message: 'Файл не был загружен' };
    }

    // Проверяем тип файла (только изображения)
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return { success: false, message: 'Разрешены только изображения (JPEG, PNG, GIF, WebP)' };
    }

    // Проверяем размер файла (максимум 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return { success: false, message: 'Размер файла не должен превышать 5MB' };
    }

    try {
      // Создаем уникальное имя файла
      const fileExtension = path.extname(file.originalname);
      const fileName = `${playerId}-${Date.now()}${fileExtension}`;
      const uploadsDir = path.join(process.cwd(), 'uploads', 'skins');
      const filePath = path.join(uploadsDir, fileName);

      // Сохраняем файл
      fs.writeFileSync(filePath, file.buffer);

      // Формируем URL для доступа к файлу
      const skinUrl = `/uploads/skins/${fileName}`;

      // Обновляем скин персонажа в базе данных
      const result = await this.gameService.updatePlayerParameter(playerId, 'skin', skinUrl);

      if (result.success) {
        return {
          success: true,
          skinUrl,
          player: result.player,
        };
      } else {
        // Удаляем файл, если не удалось обновить в БД
        fs.unlinkSync(filePath);
        return { success: false, message: result.message || 'Не удалось обновить скин персонажа' };
      }
    } catch (error) {
      return { success: false, message: `Ошибка при сохранении файла: ${error.message}` };
    }
  }
}
