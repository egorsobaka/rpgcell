import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { AppService } from './app.service';
import { GameService } from './game.service';

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
}
