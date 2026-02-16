import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CellColor,
  CellPosition,
  ChatMessage,
  LeaderboardEntry,
  LocalChat,
  LocalChatMessage,
  PlayerState,
} from './game.types';
import { Player, PlayerDocument } from './schemas/player.schema';
import { Cell, CellDocument } from './schemas/cell.schema';
import { Chat, ChatDocument } from './schemas/chat.schema';
import { LocalChat as LocalChatModel, LocalChatDocument } from './schemas/local-chat.schema';
import { Building, BuildingDocument } from './schemas/building.schema';

// Генерация палитры из 100 HEX-цветов с использованием золотого угла
function hslToHex(h: number, s: number, l: number): CellColor {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h >= 60 && h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h >= 180 && h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h >= 240 && h < 300) {
    r = c;
    g = 0;
    b = x;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  const toHex = (v: number) => {
    const hv = Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
    return hv;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function generateColorPalette(count: number): CellColor[] {
  const colors: CellColor[] = [];
  for (let i = 0; i < count; i++) {
    const hue = (i * 137.508) % 360; // золотой угол
    const saturation = 60 + ((i * 7) % 40); // 60-100%
    const lightness = 40 + ((i * 11) % 30); // 40-70%
    colors.push(
      hslToHex(Math.floor(hue), Math.floor(saturation), Math.floor(lightness)),
    );
  }
  return colors;
}

// Базовый набор цветов, которые игрок может открывать по очереди (широкий спектр RGB)
// Увеличиваем количество до 256, чтобы плотнее покрыть весь диапазон #000000-#ffffff
const BASE_COLORS: CellColor[] = generateColorPalette(256);

// Фрактальный генератор цвета клетки с использованием золотого сечения
const PHI = (1 + Math.sqrt(5)) / 2;
const GOLDEN_CONJUGATE = PHI - 1; // ~0.618

function fract(x: number): number {
  return x - Math.floor(x);
}

// Вычисление силы клетки по красному компоненту
function getCellPowerFromColor(color: CellColor): number {
  const hex = color.replace('#', '');
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    return Math.max(1, r + 1); // Сила от 1 до 256
  }
  return 1;
}

// Вычисление весов для цветов (обратно пропорционально силе)
function calculateColorWeights(): number[] {
  const weights: number[] = [];
  for (const color of BASE_COLORS) {
    const power = getCellPowerFromColor(color);
    // Вес обратно пропорционален силе в степени 1.5
    // Это означает, что сильные клетки появляются реже
    const weight = 1 / Math.pow(power, 1.5);
    weights.push(weight);
  }
  return weights;
}

// Предвычисленные веса для всех цветов
const COLOR_WEIGHTS = calculateColorWeights();
const TOTAL_WEIGHT = COLOR_WEIGHTS.reduce((sum, w) => sum + w, 0);

// Взвешенная выборка цвета на основе весов
function weightedRandomColor(seed: number): CellColor {
  // Используем seed для генерации псевдослучайного числа в диапазоне [0, TOTAL_WEIGHT)
  // Преобразуем seed в значение от 0 до 1, используя хеш-функцию
  const hash = Math.abs(seed);
  const normalized = (hash % 1000000) / 1000000;
  const randomValue = normalized * TOTAL_WEIGHT;
  
  let cumulativeWeight = 0;
  for (let i = 0; i < BASE_COLORS.length; i++) {
    cumulativeWeight += COLOR_WEIGHTS[i];
    if (randomValue <= cumulativeWeight) {
      return BASE_COLORS[i];
    }
  }
  // Fallback на последний цвет (на случай ошибок округления)
  return BASE_COLORS[BASE_COLORS.length - 1];
}

// Интерфейс для параметров клетки
interface CellParams {
  food: number; // Кол-во еды (0-255, шаг 8)
  building: number; // Кол-во строительных единиц (0-255, шаг 8)
  experience: number; // Кол-во опыта (0-255, шаг 8)
  power: number; // Сила клетки (1-256, влияет на яркость)
}

// Возможные значения силы клетки (с шагом 8, от 8 до 248)
const POWER_VALUES: number[] = [1]; // Минимальная сила = 1
for (let i = 1; i <= 31; i++) {
  POWER_VALUES.push(i * 8);
}

// Вычисление весов для значений силы (обратно пропорционально силе)
// Меньшие значения имеют больший вес
function calculatePowerWeights(): number[] {
  const weights: number[] = [];
  for (const power of POWER_VALUES) {
    // Вес обратно пропорционален силе в степени 1.5
    // Это означает, что сильные клетки появляются реже
    const weight = 1 / Math.pow(power, 1.5);
    weights.push(weight);
  }
  return weights;
}

// Предвычисленные веса для всех значений силы
const POWER_WEIGHTS = calculatePowerWeights();
const TOTAL_POWER_WEIGHT = POWER_WEIGHTS.reduce((sum, w) => sum + w, 0);

// Взвешенная выборка силы клетки на основе весов
function weightedRandomPower(seed: number): number {
  // Преобразуем seed в значение от 0 до 1
  const hash = Math.abs(seed);
  const normalized = (hash % 1000000) / 1000000;
  const randomValue = normalized * TOTAL_POWER_WEIGHT;
  
  let cumulativeWeight = 0;
  for (let i = 0; i < POWER_VALUES.length; i++) {
    cumulativeWeight += POWER_WEIGHTS[i];
    if (randomValue <= cumulativeWeight) {
      return POWER_VALUES[i];
    }
  }
  // Fallback на минимальное значение (на случай ошибок округления)
  return POWER_VALUES[0];
}

// Генерация параметров клетки с минимальной силой
function generateCellParamsWithMinPower(x: number, y: number, minPower: number): CellParams {
  // Диагональ вида x + y = const (идет сверху-слева вниз-вправо)
  const diagonalSum = x + y;
  
  // Разбиваем диагональ на сегменты длиной максимум 10 клеток
  const segmentIndex = Math.floor(diagonalSum / 10);
  
  // Генерируем ширину линии для этого сегмента (от 3)
  const widthSeed = (segmentIndex * 73856093) ^ (segmentIndex * 19349663);
  const lineWidth = 3 + (Math.abs(widthSeed) % 4); // 3-6 клеток шириной
  
  // Определяем перпендикулярную координату для создания полос шириной lineWidth
  // Используем x - y для создания перпендикулярных полос
  const perpendicular = x - y;
  const stripIndex = Math.floor(perpendicular / lineWidth);
  
  // Генерируем seed для параметров
  const paramSeed = (segmentIndex * 73856093) ^ (stripIndex * 19349663);
  
  // Генерируем параметры в заданных интервалах
  const foodSeed = Math.abs(paramSeed * 73856093) % 201; // 0-200 -> 30-230
  const buildingSeed = Math.abs(paramSeed * 19349663) % 201; // 0-200 -> 30-230
  const powerSeed = (paramSeed * 48273629) ^ (paramSeed * 73856093);
  
  const food = 30 + foodSeed;
  const building = 30 + buildingSeed;
  
  // Сила клетки: выбираем из POWER_VALUES, но не меньше minPower
  // Минимальная сила должна быть не меньше maxLevel (минимальная сила игроков)
  const actualMinPower = Math.max(1, minPower);
  
  // Находим ближайшее значение из POWER_VALUES, которое >= actualMinPower
  const validPowers = POWER_VALUES.filter(p => p >= actualMinPower);
  let power: number;
  if (validPowers.length > 0) {
    // Выбираем случайную силу из валидных значений (>= actualMinPower)
    // Используем взвешенную выборку, но только среди валидных значений
    // Применяем веса для более вероятного выбора меньших значений
    const validWeights: number[] = [];
    let totalWeight = 0;
    for (const p of validPowers) {
      const weight = 1 / Math.pow(p, 1.5);
      validWeights.push(weight);
      totalWeight += weight;
    }
    
    const normalized = (Math.abs(powerSeed) % 1000000) / 1000000;
    const randomValue = normalized * totalWeight;
    
    let cumulativeWeight = 0;
    power = validPowers[0]; // Инициализируем первым валидным значением
    for (let i = 0; i < validPowers.length; i++) {
      cumulativeWeight += validWeights[i];
      if (randomValue <= cumulativeWeight) {
        power = validPowers[i];
        break;
      }
    }
  } else {
    // Если actualMinPower больше максимального значения, используем максимальное
    power = POWER_VALUES[POWER_VALUES.length - 1];
  }
  
  // Генерируем опыт с учетом силы
  const powerFactor = (power - 1) / (248 - 1);
  const maxExperience = Math.round(20 + powerFactor * (230 - 20));
  const experienceRange = maxExperience - 20 + 1;
  
  const experienceSeed = Math.abs(paramSeed * 83492791) % 1000;
  const randomValue = experienceSeed / 1000;
  
  const exponent = 1 + (1 - powerFactor) * 2;
  const adjustedValue = Math.pow(randomValue, exponent);
  const experience = 20 + Math.floor(adjustedValue * experienceRange);
  
  return { food, building, experience, power };
}

// Генерация параметров клетки с шагом 8
function generateCellParams(x: number, y: number): CellParams {
  // Диагональ вида x + y = const (идет сверху-слева вниз-вправо)
  const diagonalSum = x + y;
  
  // Разбиваем диагональ на сегменты длиной максимум 10 клеток
  const segmentIndex = Math.floor(diagonalSum / 10);
  
  // Генерируем ширину линии для этого сегмента (от 3)
  const widthSeed = (segmentIndex * 73856093) ^ (segmentIndex * 19349663);
  const lineWidth = 3 + (Math.abs(widthSeed) % 4); // 3-6 клеток шириной
  
  // Определяем перпендикулярную координату для создания полос шириной lineWidth
  // Используем x - y для создания перпендикулярных полос
  const perpendicular = x - y;
  const stripIndex = Math.floor(perpendicular / lineWidth);
  
  // Генерируем seed для параметров
  const paramSeed = (segmentIndex * 73856093) ^ (stripIndex * 19349663);
  
  // Генерируем параметры в заданных интервалах
  // food: от 30 до 230
  // building: от 30 до 230
  // experience: от 20 до 230 (но зависит от силы - чем меньше сила, тем меньше вероятность большого опыта)
  // Используем разные части seed для разных параметров
  const foodSeed = Math.abs(paramSeed * 73856093) % 201; // 0-200 -> 30-230
  const buildingSeed = Math.abs(paramSeed * 19349663) % 201; // 0-200 -> 30-230
  const powerSeed = (paramSeed * 48273629) ^ (paramSeed * 73856093); // Комбинируем для лучшей случайности
  
  const food = 30 + foodSeed;
  const building = 30 + buildingSeed;
  
  // Сила клетки от 1 до 248 (1, 8, 16, 24, ...), взвешенная выборка (меньшие значения более вероятны)
  const power = weightedRandomPower(powerSeed);
  
  // Генерируем опыт с учетом силы: чем меньше сила, тем меньше вероятность большого опыта
  // Максимальный опыт линейно зависит от силы: при power=1 -> maxExperience=20, при power=248 -> maxExperience=230
  const powerFactor = (power - 1) / (248 - 1); // Нормализуем power к [0, 1]
  const maxExperience = Math.round(20 + powerFactor * (230 - 20)); // 20 до 230
  const experienceRange = maxExperience - 20 + 1; // Количество возможных значений опыта
  
  // Генерируем опыт с взвешенной вероятностью (меньшие значения более вероятны при маленькой силе)
  const experienceSeed = Math.abs(paramSeed * 83492791) % 1000; // 0-999 для более точной выборки
  const randomValue = experienceSeed / 1000; // 0 до 1
  
  // Применяем степенную функцию: чем меньше сила, тем больше "сжатие" к меньшим значениям
  // При powerFactor=0 (сила=1): степень=3, сильное сжатие к малым значениям
  // При powerFactor=1 (сила=248): степень=1, равномерное распределение
  const exponent = 1 + (1 - powerFactor) * 2; // Степень от 1 до 3
  const adjustedValue = Math.pow(randomValue, exponent);
  const experience = 20 + Math.floor(adjustedValue * experienceRange);
  
  return { food, building, experience, power };
}

// Генерация названия типа местности на основе пропорций еды и строительства
// Для одинаковых пропорций возвращается одинаковое название
function generateCellName(params: CellParams): string {
  const { food, building } = params;
  const total = food + building;
  
  if (total === 0) {
    return 'Пустота';
  }
  
  // Вычисляем пропорцию еды от общей суммы (food + building)
  // Округляем до диапазонов для детерминированности
  const foodRatio = food / total;
  
  // Определяем категорию на основе пропорции (округление до 10% для одинаковых названий)
  const category = Math.floor(foodRatio * 10); // 0-10
  
  // Категории биомов на основе пропорции еды/строительства
  if (category <= 1) {
    // 0-10% еды, 90-100% строительства - каменистые/строительные биомы
    return 'Степь';
  } else if (category <= 2) {
    // 10-20% еды, 80-90% строительства
    return 'Пустыня';
  } else if (category <= 3) {
    // 20-30% еды, 70-80% строительства
    return 'Саванна';
  } else if (category <= 4) {
    // 30-40% еды, 60-70% строительства
    return 'Прерия';
  } else if (category <= 5) {
    // 40-50% еды, 50-60% строительства - сбалансированные биомы
    return 'Луга';
  } else if (category <= 6) {
    // 50-60% еды, 40-50% строительства
    return 'Роща';
  } else if (category <= 7) {
    // 60-70% еды, 30-40% строительства
    return 'Лес';
  } else if (category <= 8) {
    // 70-80% еды, 20-30% строительства
    return 'Тайга';
  } else if (category <= 9) {
    // 80-90% еды, 10-20% строительства
    return 'Джунгли';
  } else {
    // 90-100% еды, 0-10% строительства - плодородные биомы
    return 'Цветущая долина';
  }
}

// Вычисление цвета из параметров клетки
// r = building + (115 - power)
// g = food + (115 - power)
// b = (115 - power)
// Если есть constructionPoints, клетка становится серой и темнеет пропорционально очкам
function paramsToColor(params: CellParams, constructionPoints: number = 0, constructionType?: number): CellColor {
  // Если есть строительные очки, клетка становится серой
  if (constructionPoints > 0 && constructionType !== undefined && constructionType !== null && constructionType > 0) {
    // Максимальное значение строительных очков = constructionType * 255
    const maxConstructionPoints = constructionType * 255;
    // Затемнение рассчитывается как отношение constructionPoints к максимальному значению
    // brightness = 255 - (constructionPoints / maxConstructionPoints) * 255
    const fillRatio = Math.min(1, Math.max(0, constructionPoints / maxConstructionPoints));
    const brightness = Math.max(0, 255 - fillRatio * 255);
    const toHex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
    return `#${toHex(brightness)}${toHex(brightness)}${toHex(brightness)}`;
  }
  
  const brightness = 115 - params.power;
  
  // Вычисляем компоненты RGB
  let r = params.building + brightness;
  let g = params.food + brightness;
  let b = brightness; // b = (115 - power), без experience
  
  // Ограничиваем значения до 255
  r = Math.min(255, Math.max(0, r));
  g = Math.min(255, Math.max(0, g));
  b = Math.min(255, Math.max(0, b));
  
  // Конвертируем в HEX
  const toHex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Генератор диагональных линий с ограничением длины и случайной шириной
// Теперь генерирует параметры клетки и вычисляет цвет из них
function pseudoRandomColor(x: number, y: number): CellColor {
  const params = generateCellParams(x, y);
  return paramsToColor(params, 0);
}


@Injectable()
export class GameService {
  // Источники случайных цветов на карте
  private colorSources: { position: CellPosition; color: CellColor }[] = [
    { position: { x: -10, y: 0 }, color: BASE_COLORS[5] },
    { position: { x: 10, y: 0 }, color: BASE_COLORS[25] },
    { position: { x: 0, y: -10 }, color: BASE_COLORS[55] },
    { position: { x: 0, y: 10 }, color: BASE_COLORS[105] },
  ];

  // Кеш игроков в памяти для быстрого доступа (обновляется при изменениях)
  private playersCache = new Map<string, PlayerState>();

  constructor(
    @InjectModel(Player.name) private playerModel: Model<PlayerDocument>,
    @InjectModel(Cell.name) private cellModel: Model<CellDocument>,
    @InjectModel(Chat.name) private chatModel: Model<ChatDocument>,
    @InjectModel(LocalChatModel.name) private localChatModel: Model<LocalChatDocument>,
    @InjectModel(Building.name) private buildingModel: Model<BuildingDocument>,
  ) {
    // Инициализируем постройки при старте
    this.initializeBuildings();
  }

  // Инициализация построек в базе данных
  private async initializeBuildings(): Promise<void> {
    try {
      // Стена
      await this.buildingModel.findOneAndUpdate(
        { name: 'Стена' },
        {
          name: 'Стена',
          structure: [{ x: 0, y: 0, a: 400, t: [2, 3, 4, 5] }],
          cellPower: 16,
          cellHealth: 1000,
        },
        { upsert: true },
      ).exec();

      // Дом
      await this.buildingModel.findOneAndUpdate(
        { name: 'Дом' },
        {
          name: 'Дом',
          structure: [
            { x: 0, y: 0, a: 400, t: [2, 3, 4, 5] },
            { x: 1, y: 0, a: 400, t: [2, 3, 4, 5] },
            { x: 0, y: 1, a: 400, t: [2, 3, 4, 5] },
            { x: 1, y: 1, a: 400, t: [2, 3, 4, 5] },
          ],
          cellPower: 16,
          cellHealth: 1000,
        },
        { upsert: true },
      ).exec();
    } catch (error) {
      console.error('Ошибка при инициализации построек:', error);
    }
  }

  async getPlayerById(playerId: string): Promise<PlayerState | null> {
    // Проверяем кеш
    const cached = this.playersCache.get(playerId);
    if (cached) return cached;

    // Загружаем из MongoDB
    const player = await this.playerModel.findOne({ id: playerId }).lean().exec();
    if (!player) return null;
    
    const playerState = this.playerToState(player);
    // Проверяем увеличение веса при загрузке игрока (на случай, если порог уже достигнут)
    this.checkWeightIncrease(playerState);
    // Если вес изменился, сохраняем изменения
    if (playerState.weight !== (player.weight ?? 255)) {
      await this.savePlayer(playerState);
    }
    this.playersCache.set(playerId, playerState);
    return playerState;
  }

  async getOrCreatePlayer(playerId: string): Promise<PlayerState> {
    // Проверяем кеш
    const cached = this.playersCache.get(playerId);
    if (cached) return cached;

    // Загружаем из MongoDB
    let player = await this.playerModel.findOne({ id: playerId }).lean().exec();
    
    // Миграция: если у существующего игрока нет новых полей, инициализируем их
    if (player && (player.health === undefined || player.maxHealth === undefined || player.defense === undefined || player.luck === undefined || player.regeneration === undefined || player.totalFoodEaten === undefined)) {
      await this.playerModel.findOneAndUpdate(
        { id: playerId },
        {
          $set: {
            health: player.health ?? 100,
            maxHealth: player.maxHealth ?? 100,
            defense: player.defense ?? 0,
            luck: player.luck ?? 0,
            regeneration: player.regeneration ?? 0,
            totalFoodEaten: player.totalFoodEaten ?? 0,
          },
        },
      );
      // Перезагружаем игрока после миграции
      player = await this.playerModel.findOne({ id: playerId }).lean().exec();
    }
    
    if (!player) {
      // Создаем нового игрока с переданным playerId (который должен быть постоянным UUID)
      const newPlayer = new this.playerModel({
        id: playerId,
        name: `Player-${playerId.slice(0, 4)}`,
        position: { x: 0, y: 0 },
        unlockedColors: [],
        inventory: {},
        totalCollected: 0,
        colorLevels: {},
        satiety: 255,
        weight: 255,
        stamina: 1,
        collectionPower: 1,
        experience: 0,
        power: 1,
        level: 1,
        availableUpgrades: 0,
        health: 100,
        maxHealth: 100,
        defense: 0,
        luck: 0,
        regeneration: 0,
        totalFoodEaten: 0,
      });
      await newPlayer.save();
      player = newPlayer.toObject();
      
      // Добавляем игрока в чат его начальной позиции
      const key = `${player.position.x}:${player.position.y}`;
      await this.localChatModel.findOneAndUpdate(
        { key },
        {
          $setOnInsert: {
            key,
            cellPosition: player.position,
            participants: [],
            messages: [],
          },
        },
        { upsert: true, new: true },
      );
      await this.localChatModel.updateOne(
        { key },
        { $addToSet: { participants: playerId } },
      );
    }
    
    const playerState = this.playerToState(player);
    // Проверяем увеличение веса при загрузке игрока (на случай, если порог уже достигнут)
    this.checkWeightIncrease(playerState);
    // Если вес изменился, сохраняем изменения
    if (playerState.weight !== (player.weight ?? 255)) {
      await this.savePlayer(playerState);
    }
    this.playersCache.set(playerId, playerState);
    return playerState;
  }

  // Создать нового игрока с новым постоянным UUID
  async createNewPlayer(userId?: string): Promise<PlayerState> {
    const newPlayerId = randomUUID();
    const player = await this.getOrCreatePlayer(newPlayerId);
    // Если передан userId, привязываем персонажа к пользователю
    if (userId && player) {
      await this.playerModel.findOneAndUpdate(
        { id: newPlayerId },
        { $set: { userId } },
      ).exec();
      player.userId = userId;
    }
    return player;
  }

  // Получить всех персонажей пользователя
  async getPlayerCharacters(userId: string): Promise<PlayerState[]> {
    const players = await this.playerModel.find({ userId }).lean().exec();
    return players.map(p => this.playerToState(p));
  }

  // Переключиться на другого персонажа
  async switchCharacter(userId: string, characterId: string): Promise<PlayerState | null> {
    // Проверяем, что персонаж принадлежит пользователю
    const player = await this.playerModel.findOne({ id: characterId, userId }).lean().exec();
    if (!player) {
      return null;
    }
    const playerState = this.playerToState(player);
    // Проверяем увеличение веса при загрузке
    this.checkWeightIncrease(playerState);
    if (playerState.weight !== (player.weight ?? 255)) {
      await this.savePlayer(playerState);
    }
    this.playersCache.set(characterId, playerState);
    return playerState;
  }

  private playerToState(player: any): PlayerState {
    return {
      id: player.id,
      name: player.name,
      position: player.position,
      unlockedColors: player.unlockedColors || [],
      inventory: player.inventory || {},
      totalCollected: player.totalCollected || 0,
      colorLevels: player.colorLevels || {},
      satiety: Math.round(player.satiety ?? 255),
      weight: player.weight ?? 255,
      stamina: player.stamina ?? 1,
      collectionPower: player.collectionPower ?? 1,
      experience: player.experience ?? 0,
      power: player.power ?? 1,
      level: player.level ?? 1,
      availableUpgrades: player.availableUpgrades ?? 0,
      health: player.health ?? 100,
      maxHealth: player.maxHealth ?? 100,
      defense: player.defense ?? 0,
      luck: player.luck ?? 0,
      regeneration: player.regeneration ?? 0,
      buildings: player.buildings || {},
      totalFoodEaten: Math.round(player.totalFoodEaten ?? 0),
      userId: player.userId,
      skin: player.skin,
    };
  }

  private async savePlayer(playerState: PlayerState): Promise<void> {
    await this.playerModel.findOneAndUpdate(
      { id: playerState.id },
      {
        $set: {
          name: playerState.name,
          position: playerState.position,
          unlockedColors: playerState.unlockedColors,
          inventory: playerState.inventory,
          totalCollected: playerState.totalCollected,
          colorLevels: playerState.colorLevels,
        satiety: Math.round(playerState.satiety),
        weight: playerState.weight,
        stamina: playerState.stamina,
        collectionPower: playerState.collectionPower,
        experience: playerState.experience,
        power: playerState.power,
        level: playerState.level,
        availableUpgrades: playerState.availableUpgrades,
        health: playerState.health,
        maxHealth: playerState.maxHealth,
        defense: playerState.defense,
        luck: playerState.luck,
        regeneration: playerState.regeneration,
        buildings: playerState.buildings || {},
        totalFoodEaten: Math.round(playerState.totalFoodEaten ?? 0),
        },
      },
      { upsert: true },
    );
    // Обновляем кеш
    this.playersCache.set(playerState.id, playerState);
  }


  async removePlayer(clientId: string): Promise<void> {
    await this.playerModel.deleteOne({ id: clientId });
    this.playersCache.delete(clientId);
  }

  // Удалить всех игроков (для тестирования/сброса)
  async removeAllPlayers(): Promise<{ deletedCount: number }> {
    const result = await this.playerModel.deleteMany({}).exec();
    this.playersCache.clear();
    return { deletedCount: result.deletedCount || 0 };
  }

  // Перегенерировать карту (удалить все клетки)
  async regenerateMap(): Promise<{ deletedCount: number }> {
    const result = await this.cellModel.deleteMany({}).exec();
    return { deletedCount: result.deletedCount || 0 };
  }

  // Извлечение компонентов RGB из HEX цвета
  private getRGBComponents(hexColor: string): { r: number; g: number; b: number } {
    // Убираем # если есть
    const hex = hexColor.replace('#', '');
    if (hex.length === 6) {
      // #RRGGBB
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return { r, g, b };
    } else if (hex.length === 3) {
      // #RGB -> #RRGGBB
      const r = parseInt(hex.substring(0, 1) + hex.substring(0, 1), 16);
      const g = parseInt(hex.substring(1, 2) + hex.substring(1, 2), 16);
      const b = parseInt(hex.substring(2, 3) + hex.substring(2, 3), 16);
      return { r, g, b };
    }
    return { r: 0, g: 0, b: 0 };
  }

  // Извлечение зеленого компонента из HEX цвета для восстановления сытости
  private getGreenComponent(hexColor: string): number {
    return this.getRGBComponents(hexColor).g;
  }

  // Вычисление веса одного элемента инвентаря из параметров
  // Вес = (количество * food / 16) + (количество * experience / 32)
  private getItemWeightFromParams(params: CellParams, count: number): number {
    return (count * params.food / 16) + (count * params.experience / 32);
  }

  // Вычисление веса одного элемента инвентаря из цвета (для обратной совместимости)
  // Вес = (количество * зеленый компонент / 16) + (количество * синий компонент / 32)
  private getItemWeight(color: string, count: number): number {
    const { g, b } = this.getRGBComponents(color);
    return (count * g / 16) + (count * b / 32);
  }

  // Вычисление общего веса инвентаря
  // Пытается использовать параметры клеток из БД, если доступны
  private async getInventoryWeight(inventory: Record<string, number>): Promise<number> {
    let totalWeight = 0;
    for (const [color, count] of Object.entries(inventory)) {
      if (count > 0) {
        // Пытаемся найти клетку с таким цветом в БД
        const cell = await this.cellModel.findOne({ color }).exec();
        if (cell && cell.food !== undefined && cell.experience !== undefined) {
          const params: CellParams = {
            food: cell.food,
            building: cell.building ?? 0,
            experience: cell.experience,
            power: cell.power ?? 1,
          };
          totalWeight += this.getItemWeightFromParams(params, count);
        } else {
          // Используем старую логику из цвета
          totalWeight += this.getItemWeight(color, count);
        }
      }
    }
    return Math.round(totalWeight);
  }

  // Синхронная версия для обратной совместимости (используется в старых местах)
  private getInventoryWeightSync(inventory: Record<string, number>): number {
    let totalWeight = 0;
    for (const [color, count] of Object.entries(inventory)) {
      if (count > 0) {
        totalWeight += this.getItemWeight(color, count);
      }
    }
    return Math.round(totalWeight);
  }

  // Вычисление максимального веса инвентаря
  // Максимальный вес = (вес игрока / 2) + (вес игрока / 2 * выносливость / 10)
  private getMaxInventoryWeight(playerWeight: number, playerStamina: number): number {
    return Math.round((playerWeight / 2) + (playerWeight / 2 * playerStamina / 10));
  }

  // Вычисление количества добытых единиц от 1 до 10 на основе удачи и уровня
  // Вероятность выпадения N = (удача / N * уровень игрока)
  private calculateCollectedAmount(luck: number, level: number): number {
    // Вычисляем вероятности для каждого значения от 1 до 10
    const probabilities: number[] = [];
    let totalWeight = 0;
    
    for (let amount = 1; amount <= 10; amount++) {
      // Вероятность выпадения amount = (удача / amount * уровень)
      const probability = (luck / amount) * level;
      probabilities.push(probability);
      totalWeight += probability;
    }
    
    // Если сумма вероятностей равна 0 или очень мала, возвращаем минимальное значение
    if (totalWeight <= 0) {
      return 1;
    }
    
    // Генерируем случайное значение от 0 до totalWeight
    const randomValue = Math.random() * totalWeight;
    
    // Выбираем значение на основе накопленных вероятностей
    let cumulativeWeight = 0;
    for (let amount = 1; amount <= 10; amount++) {
      cumulativeWeight += probabilities[amount - 1];
      if (randomValue <= cumulativeWeight) {
        return amount;
      }
    }
    
    // Fallback на минимальное значение
    return 1;
  }

  // Вычисление силы клетки из параметров клетки
  // Если параметры есть в БД, используем их, иначе вычисляем из цвета (для обратной совместимости)
  private async getCellPowerFromDB(pos: CellPosition): Promise<number> {
    const key = `${pos.x}:${pos.y}`;
    const cell = await this.cellModel.findOne({ key }).exec();
    if (cell && cell.power !== undefined && cell.power !== null) {
      return cell.power;
    }
    // Если параметров нет, генерируем их
    const params = generateCellParams(pos.x, pos.y);
    return params.power;
  }

  // Вычисление силы клетки: используем параметр power (от 1 до 256)
  // Это минимальная сила сбора, необходимая для тапа
  private async getCellPower(pos: CellPosition): Promise<number> {
    return await this.getCellPowerFromDB(pos);
  }

  // Синхронная версия для обратной совместимости (используется в старых местах)
  private getCellPowerSync(hexColor: string): number {
    // Для обратной совместимости вычисляем из цвета, если параметров нет
    // Но это не должно использоваться в новой логике
    const { r } = this.getRGBComponents(hexColor);
    return Math.max(1, r + 1); // От 1 до 256 (0-255 + 1)
  }

  // Использование клетки из инвентаря для восстановления сытости или получения опыта
  async useInventoryItem(
    clientId: string,
    color: CellColor,
    useType: 'satiety' | 'experience' = 'satiety',
  ): Promise<{ success: boolean; satietyRestored: number; newSatiety: number; experienceGained: number; newExperience: number }> {
    const player = await this.getOrCreatePlayer(clientId);
    if (!player) {
      return { success: false, satietyRestored: 0, newSatiety: 0, experienceGained: 0, newExperience: 0 };
    }

    // Проверяем, есть ли этот цвет в инвентаре
    const count = player.inventory[color] ?? 0;
    if (count <= 0) {
      return { success: false, satietyRestored: 0, newSatiety: player.satiety, experienceGained: 0, newExperience: player.experience };
    }

    let satietyRestored = 0;
    let experienceGained = 0;

    // Пытаемся найти клетку с таким цветом в БД, чтобы получить параметры
    // Если не найдем, используем старую логику (из цвета)
    let cellParams: CellParams | null = null;
    const cell = await this.cellModel.findOne({ color }).exec();
    if (cell && cell.food !== undefined && cell.building !== undefined && 
        cell.experience !== undefined && cell.power !== undefined) {
      cellParams = {
        food: cell.food,
        building: cell.building,
        experience: cell.experience,
        power: cell.power,
      };
    }

    if (useType === 'satiety') {
      // Проверяем, не полная ли уже сытость
      if (player.satiety >= player.weight) {
        return { success: false, satietyRestored: 0, newSatiety: player.satiety, experienceGained: 0, newExperience: player.experience };
      }
      // Вычисляем восстановление сытости на основе food параметра или зеленого компонента
      if (cellParams) {
        satietyRestored = cellParams.food;
      } else {
        const greenComponent = this.getGreenComponent(color);
        satietyRestored = greenComponent;
      }
      // Восстанавливаем сытость (максимум weight)
      player.satiety = Math.round(Math.min(player.weight, player.satiety + satietyRestored));
      
      // Увеличиваем счетчик съеденной еды
      player.totalFoodEaten = Math.round((player.totalFoodEaten ?? 0) + satietyRestored);
      
      // Проверяем увеличение веса при достижении порога сытости
      this.checkWeightIncrease(player);
    } else if (useType === 'experience') {
      // Вычисляем опыт на основе experience параметра или синего компонента
      if (cellParams) {
        experienceGained = cellParams.experience;
      } else {
        const { b } = this.getRGBComponents(color);
        experienceGained = b;
      }
      // Добавляем опыт
      player.experience += experienceGained;
      // Проверяем достижение нового уровня
      this.checkLevelUp(player);
    }

    // Уменьшаем количество клеток в инвентаре
    player.inventory[color] = count - 1;
    if (player.inventory[color] === 0) {
      delete player.inventory[color];
    }

    // Сохраняем изменения в MongoDB
    await this.savePlayer(player);

    return {
      success: true,
      satietyRestored,
      newSatiety: player.satiety,
      experienceGained,
      newExperience: player.experience,
    };
  }

  // Проверка достижения нового уровня
  private checkLevelUp(player: PlayerState): void {
    const initialExp = 255; // Начальный опыт
    const requiredExp = Math.ceil(initialExp + initialExp * player.level * 0.1);
    while (player.experience >= requiredExp) {
      player.experience -= requiredExp;
      player.level += 1;
      player.availableUpgrades += 1;
    }
  }

  // Проверка и увеличение веса при достижении порога съеденной еды
  private checkWeightIncrease(player: PlayerState): void {
    // Порог съеденной еды для увеличения веса: weight * level
    const foodThreshold = Math.round(player.weight * player.level);
    
    // Если количество съеденной еды достигло или превысило порог
    if ((player.totalFoodEaten ?? 0) >= foodThreshold) {
      // Увеличиваем вес на: weight * 0.1 * (min(collectionPower, power, stamina, defense) / (collectionPower + power + stamina + defense))
      const defense = player.defense ?? 0;
      const minStat = Math.min(player.collectionPower, player.power, player.stamina, defense);
      const sumStats = player.collectionPower + player.power + player.stamina + defense;
      const weightIncrease = player.weight * 0.1 * (minStat / Math.max(1, sumStats)); // Math.max(1, ...) чтобы избежать деления на 0
      player.weight = Math.ceil(player.weight + weightIncrease);
      
      // Сбрасываем счетчик съеденной еды
      player.totalFoodEaten = 0;
    }
  }

  // Изменить имя игрока
  async updatePlayerWeight(playerId: string, newWeight: number): Promise<void> {
    await this.playerModel.findOneAndUpdate(
      { id: playerId },
      { $set: { weight: newWeight } },
    ).exec();
    // Обновляем кеш, если персонаж там есть
    const cached = this.playersCache.get(playerId);
    if (cached) {
      cached.weight = newWeight;
      this.playersCache.set(playerId, cached);
    }
  }

  // Универсальный метод для обновления любого параметра персонажа
  async updatePlayerParameter(
    playerId: string,
    parameter: string,
    value: any,
  ): Promise<{ success: boolean; message?: string; player?: PlayerState }> {
    // Проверяем, что персонаж существует
    const player = await this.playerModel.findOne({ id: playerId }).lean().exec();
    if (!player) {
      return { success: false, message: `Персонаж с ID ${playerId} не найден` };
    }

    // Список разрешенных параметров для обновления
    const allowedParameters = [
      'name',
      'position',
      'satiety',
      'weight',
      'stamina',
      'collectionPower',
      'experience',
      'power',
      'level',
      'availableUpgrades',
      'health',
      'maxHealth',
      'defense',
      'luck',
      'regeneration',
      'totalCollected',
      'totalFoodEaten',
      'inventory',
      'unlockedColors',
      'colorLevels',
      'buildings',
      'userId',
      'skin',
    ];

    if (!allowedParameters.includes(parameter)) {
      return { success: false, message: `Параметр "${parameter}" не разрешен для обновления` };
    }

    // Валидация значений для некоторых параметров
    if (parameter === 'name' && (typeof value !== 'string' || value.trim().length === 0)) {
      return { success: false, message: 'Имя не может быть пустым' };
    }

    if (parameter === 'name' && value.trim().length > 50) {
      return { success: false, message: 'Имя слишком длинное (максимум 50 символов)' };
    }

    if (parameter === 'position' && (!value || typeof value.x !== 'number' || typeof value.y !== 'number')) {
      return { success: false, message: 'Позиция должна быть объектом с полями x и y (числа)' };
    }

    // Обновляем параметр в базе данных
    const updateData: any = {};
    updateData[parameter] = value;

    await this.playerModel.findOneAndUpdate(
      { id: playerId },
      { $set: updateData },
    ).exec();

    // Обновляем кеш
    const cached = this.playersCache.get(playerId);
    if (cached) {
      (cached as any)[parameter] = value;
      this.playersCache.set(playerId, cached);
    } else {
      // Если персонажа нет в кеше, загружаем его заново
      const updatedPlayer = await this.playerModel.findOne({ id: playerId }).lean().exec();
      if (updatedPlayer) {
        const playerState = this.playerToState(updatedPlayer);
        this.playersCache.set(playerId, playerState);
        return { success: true, player: playerState };
      }
    }

    // Возвращаем обновленного персонажа
    const updatedPlayer = await this.playerModel.findOne({ id: playerId }).lean().exec();
    if (updatedPlayer) {
      const playerState = this.playerToState(updatedPlayer);
      return { success: true, player: playerState };
    }

    return { success: true };
  }

  async changePlayerName(clientId: string, newName: string): Promise<{ success: boolean; message?: string }> {
    if (!newName || newName.trim().length === 0) {
      return { success: false, message: 'Имя не может быть пустым' };
    }
    
    if (newName.trim().length > 50) {
      return { success: false, message: 'Имя слишком длинное (максимум 50 символов)' };
    }

    const player = await this.getOrCreatePlayer(clientId);
    if (!player) {
      return { success: false, message: 'Игрок не найден' };
    }

    player.name = newName.trim();
    await this.savePlayer(player);
    
    return { success: true };
  }

  // Применить улучшение
  async applyUpgrade(
    clientId: string,
    upgradeType: 'weight' | 'stamina' | 'collectionPower' | 'power' | 'maxHealth' | 'defense' | 'luck' | 'regeneration',
  ): Promise<{ success: boolean; message?: string }> {
    const player = await this.getOrCreatePlayer(clientId);
    if (!player) {
      return { success: false, message: 'Игрок не найден' };
    }

    if (player.availableUpgrades <= 0) {
      return { success: false, message: 'Нет доступных улучшений' };
    }

    // Инициализируем новые параметры, если они undefined
    if (player.health === undefined) player.health = 100;
    if (player.maxHealth === undefined) player.maxHealth = 100;
    if (player.defense === undefined) player.defense = 0;
    if (player.luck === undefined) player.luck = 0;
    if (player.regeneration === undefined) player.regeneration = 0;

    switch (upgradeType) {
      case 'weight':
        // Увеличиваем вес на 10%
        player.weight = Math.round(player.weight * 1.1);
        // Также увеличиваем текущую сытость пропорционально
        player.satiety = Math.round(player.satiety * 1.1);
        break;
      case 'stamina':
        player.stamina += 1;
        break;
      case 'collectionPower':
        player.collectionPower += 1;
        break;
      case 'power':
        player.power += 1;
        break;
      case 'maxHealth':
        // Увеличиваем максимальное здоровье на 20%
        player.maxHealth = Math.round(player.maxHealth * 1.2);
        // Также увеличиваем текущее здоровье пропорционально
        player.health = Math.round(player.health * 1.2);
        break;
      case 'defense':
        player.defense = (player.defense ?? 0) + 1;
        break;
      case 'luck':
        player.luck = (player.luck ?? 0) + 1;
        break;
      case 'regeneration':
        player.regeneration += 0.5;
        break;
    }

    player.availableUpgrades -= 1;

    // Убеждаемся, что все новые параметры инициализированы перед сохранением
    if (player.health === undefined) player.health = 100;
    if (player.maxHealth === undefined) player.maxHealth = 100;
    if (player.defense === undefined) player.defense = 0;
    if (player.luck === undefined) player.luck = 0;
    if (player.regeneration === undefined) player.regeneration = 0;

    // Сохраняем изменения игрока в MongoDB
    await this.savePlayer(player);
    
    // Явно обновляем кеш после сохранения
    this.playersCache.set(player.id, player);

    return { success: true };
  }

  // Получить количество сытости, которое восстановит клетка
  getSatietyRestore(color: CellColor): number {
    return this.getGreenComponent(color);
  }

  // Получить силу клетки (публичный метод)
  async getCellPowerPublic(pos: CellPosition): Promise<number> {
    return await this.getCellPower(pos);
  }

  async movePlayer(clientId: string, position: CellPosition): Promise<PlayerState | undefined> {
    const player = await this.getOrCreatePlayer(clientId);
    if (!player) return undefined;
    
    // Проверяем, изменилась ли позиция
    if (player.position.x === position.x && player.position.y === position.y) {
      return player; // Не двигаемся, не тратим сытость
    }
    
    // Рассчитываем стоимость движения: weight * 0.01 * (collectionPower - stamina)
    // Защита от отрицательного значения
    const difference = Math.max(0, player.collectionPower - player.stamina);
    const moveCost = Math.max(1, Math.round(player.weight * 0.01 * difference));
    
    // Проверяем, достаточно ли сытости для движения
    if (player.satiety < moveCost) {
      return player; // Недостаточно сытости для движения
    }
    
    // Тратим сытость на ход
    player.satiety = Math.max(0, Math.round(player.satiety - moveCost));
    
    const oldKey = `${player.position.x}:${player.position.y}`;
    player.position = position;
    const newKey = `${position.x}:${position.y}`;
    
    // Удаляем игрока из старого чата в MongoDB
    await this.localChatModel.updateOne(
      { key: oldKey },
      { $pull: { participants: clientId } },
    );
    
    // Добавляем игрока в новый чат
    await this.localChatModel.findOneAndUpdate(
      { key: newKey },
      {
        $setOnInsert: {
          key: newKey,
          cellPosition: position,
          participants: [],
          messages: [],
        },
      },
      { upsert: true },
    );
    await this.localChatModel.updateOne(
      { key: newKey },
      { $addToSet: { participants: clientId } },
    );
    
    // Сохраняем изменения игрока
    await this.savePlayer(player);
    
    return player;
  }

  // Получить или инициализировать жизни клетки
  private async getOrInitCellHealth(pos: CellPosition): Promise<number> {
    const key = `${pos.x}:${pos.y}`;
    
    // Получаем параметры клетки
    const { color, params } = await this.getCellColorInternal(pos);
    // Здоровье = сила * опыт
    const health = params.power * params.experience;
    
    // Генерируем название типа местности на основе пропорций еды и строительства
    const cellName = generateCellName(params);
    
    let cell = await this.cellModel.findOneAndUpdate(
      { key },
      {
        $setOnInsert: {
          key,
          position: pos,
          color,
          food: params.food,
          building: params.building,
          experience: params.experience,
          power: params.power,
          name: cellName,
          health,
          playerProgress: {},
        },
      },
      { upsert: true, new: true }
    ).exec();
    
    // Если клетка уже существовала, но у неё нет названия, генерируем его
    if (cell && !cell.name) {
      await this.cellModel.findOneAndUpdate(
        { key },
        { $set: { name: cellName } },
      ).exec();
    }
    
    // Если клетка существовала, но у неё нет здоровья, инициализируем его
    if (cell && (cell.health === undefined || cell.health === null)) {
      cell.health = health;
      await cell.save();
      return health;
    }
    
    return cell?.health ?? health;
  }

  // Внутренний метод для получения цвета и параметров клетки
  private async getCellColorInternal(pos: CellPosition): Promise<{ color: CellColor; params: CellParams; constructionPoints?: number; constructionType?: number; buildingName?: string; buildingId?: string; name?: string }> {
    const key = `${pos.x}:${pos.y}`;
    const cell = await this.cellModel.findOne({ key }).exec();
    
    const constructionPoints = cell?.constructionPoints ?? 0;
    const constructionType = cell?.constructionType;
    
    // Если клетка существует и имеет все параметры, возвращаем их
    if (cell && cell.color && 
        cell.food !== undefined && cell.building !== undefined && 
        cell.experience !== undefined && cell.power !== undefined) {
      // Если клетка белая (уже собрана), всегда возвращаем ее как белую
      if (cell.color === '#ffffff') {
        const params = {
          food: cell.food,
          building: cell.building,
          experience: cell.experience,
          power: cell.power,
        };
        return {
          color: '#ffffff',
          params,
          constructionPoints: 0,
          constructionType: undefined,
          name: cell.name,
        };
      }
      
      // Пересчитываем цвет с учетом строительных очков
      const params = {
        food: cell.food,
        building: cell.building,
        experience: cell.experience,
        power: cell.power,
      };
      // Если клетка является частью постройки, используем цвет постройки (красный)
      const color = cell.buildingName ? '#ff0000' : paramsToColor(params, constructionPoints, constructionType);
      return {
        color,
        params,
        constructionPoints,
        constructionType,
        buildingName: cell.buildingName,
        buildingId: cell.buildingId,
        name: cell.name,
      };
    }

    // Генерируем новые параметры только если клетка не существует
    // Если клетка существует, но не имеет всех параметров, проверяем, не белая ли она
    if (cell && cell.color === '#ffffff') {
      // Клетка белая, возвращаем ее как есть
      return {
        color: '#ffffff',
        params: {
          food: cell.food ?? 0,
          building: cell.building ?? 0,
          experience: cell.experience ?? 0,
          power: cell.power ?? 1,
        },
        constructionPoints: 0,
        constructionType: undefined,
        name: cell.name,
      };
    }

    // Генерируем новые параметры только для новых клеток
    const params = generateCellParams(pos.x, pos.y);
    const color = paramsToColor(params, constructionPoints, constructionType);
    
    // Генерируем название типа местности на основе пропорций еды и строительства
    const name = generateCellName(params);

    // Сохраняем в БД только если клетка не существует ($setOnInsert не обновит существующую)
    await this.cellModel.findOneAndUpdate(
      { key },
      {
        $setOnInsert: {
          key,
          position: pos,
          color,
          food: params.food,
          building: params.building,
          experience: params.experience,
          power: params.power,
          constructionPoints: 0,
          playerProgress: {},
        },
      },
      { upsert: true },
    ).exec();

    // Если клетка уже существовала, но у неё нет названия, генерируем его на основе параметров
    if (cell && !cell.name && params) {
      const generatedName = generateCellName(params);
      await this.cellModel.findOneAndUpdate(
        { key },
        { $set: { name: generatedName } },
      ).exec();
      return { color, params, constructionPoints, constructionType: undefined, buildingName: undefined, buildingId: undefined, name: generatedName };
    }
    
    return { color, params, constructionPoints, constructionType: undefined, buildingName: undefined, buildingId: undefined, name };
  }

  // Получить только цвет (для обратной совместимости)
  private async getCellColorOnly(pos: CellPosition): Promise<CellColor> {
    const result = await this.getCellColorInternal(pos);
    return result.color;
  }

  // Публичный метод для получения цвета клетки
  async getCellColor(pos: CellPosition): Promise<CellColor> {
    return this.getCellColorOnly(pos);
  }

  // Публичный метод для получения параметров клетки (для gateway)
  async getCellColorInternalPublic(pos: CellPosition): Promise<{ color: CellColor; params: CellParams; constructionPoints?: number; constructionType?: number; buildingName?: string; buildingId?: string; name?: string }> {
    return await this.getCellColorInternal(pos);
  }

  async collectCell(clientId: string, pos: CellPosition): Promise<PlayerState | undefined> {
    // Теперь сбор происходит только через тапы (tapColorCell)
    // Этот метод оставлен для совместимости, но не используется напрямую
    return this.getOrCreatePlayer(clientId);
  }

  async getPlayers(): Promise<PlayerState[]> {
    // Используем кеш, если он актуален, иначе загружаем из MongoDB
    // Для актуальности данных всегда загружаем из MongoDB, но обновляем кеш
    const players = await this.playerModel.find().lean().exec();
    const playerStates = players.map(p => {
      const state = this.playerToState(p);
      // Обновляем кеш актуальными данными
      this.playersCache.set(state.id, state);
      return state;
    });
    return playerStates;
  }

  async getViewportColors(center: CellPosition, radius: number): Promise<{
    position: CellPosition;
    color: CellColor;
    params?: CellParams;
    constructionPoints?: number;
    constructionType?: number;
    buildingName?: string;
    buildingId?: string;
    name?: string;
  }[]> {
    const result: { position: CellPosition; color: CellColor; params?: CellParams; constructionPoints?: number; constructionType?: number; buildingName?: string; buildingId?: string; name?: string }[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const pos = { x: center.x + dx, y: center.y + dy };
        const { color, params, constructionPoints, constructionType, buildingName, buildingId, name } = await this.getCellColorInternal(pos);
        result.push({
          position: pos,
          color,
          params,
          name,
          constructionPoints,
          constructionType,
          buildingName,
          buildingId,
        });
      }
    }
    return result;
  }

  async getLeaderboard(onlinePlayers?: Set<string>): Promise<LeaderboardEntry[]> {
    // Получаем игроков с полными данными из MongoDB (включая createdAt)
    const playerDocs = await this.playerModel.find().lean().exec();
    const now = Date.now();
    
    return playerDocs
      .map<LeaderboardEntry>((p: any) => {
        const createdAt = p.createdAt ? new Date(p.createdAt).getTime() : now;
        const playTime = Math.floor((now - createdAt) / 1000); // В секундах
        
        return {
          playerId: p.id,
          name: p.name,
          totalCollected: p.totalCollected || 0,
          level: p.level || 1,
          playTime,
          isOnline: onlinePlayers ? onlinePlayers.has(p.id) : false,
          skin: p.skin,
        };
      })
      .sort((a, b) => b.totalCollected - a.totalCollected)
      .slice(0, 50);
  }

  async addChatMessage(
    clientId: string,
    text: string,
  ): Promise<{ message: ChatMessage; player: PlayerState | undefined }> {
    const player = await this.getOrCreatePlayer(clientId);
    const message: ChatMessage = {
      id: randomUUID(),
      playerId: clientId,
      name: player?.name ?? 'Unknown',
      text,
      createdAt: Date.now(),
    };
    
    // Добавляем сообщение в MongoDB
    await this.chatModel.findOneAndUpdate(
      { id: 'global' },
      {
        $push: {
          messages: {
            $each: [message],
            $slice: -100, // Оставляем только последние 100 сообщений
          },
        },
      },
      { upsert: true },
    );

    return { message, player };
  }

  async getRecentMessages(): Promise<ChatMessage[]> {
    const chat = await this.chatModel.findOne({ id: 'global' }).lean().exec();
    if (!chat) return [];
    return (chat.messages || []).slice(-50);
  }

  // Обработка тапа по белой клетке
  async tapWhiteCell(pos: CellPosition): Promise<{
    exploded: boolean;
    affectedCells: { position: CellPosition; color: CellColor }[];
  }> {
    const key = `${pos.x}:${pos.y}`;
    const { color: currentColor } = await this.getCellColorInternal(pos);

    // Проверяем, что клетка белая
    if (currentColor !== '#ffffff') {
      return { exploded: false, affectedCells: [] };
    }

    // Получаем или создаем клетку с использованием upsert для избежания race condition
    let cell = await this.cellModel.findOneAndUpdate(
      { key },
      {
        $setOnInsert: {
          key,
          position: pos,
          color: currentColor,
          health: null,
          playerProgress: {},
        },
      },
      { upsert: true, new: true }
    ).exec();

    // Используем playerProgress для хранения счетчика тапов (используем ключ 'whiteTaps')
    const currentTaps = ((cell.playerProgress as any)['whiteTaps'] ?? 0) + 1;
    (cell.playerProgress as any)['whiteTaps'] = currentTaps;
    await cell.save();

    // Если достигли 10 тапов - взрываем
    if (currentTaps >= 10) {
      return await this.explodeWhiteCells(pos);
    }

    return { exploded: false, affectedCells: [] };
  }

  // Взрыв белых клеток в радиусе 3
  private async explodeWhiteCells(center: CellPosition): Promise<{
    exploded: boolean;
    affectedCells: { position: CellPosition; color: CellColor }[];
  }> {
    const affectedCells: { position: CellPosition; color: CellColor }[] = [];
    const radius = 3;

    // Находим все белые клетки в радиусе 3
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > radius) continue;

        const pos = { x: center.x + dx, y: center.y + dy };
        const key = `${pos.x}:${pos.y}`;
        const { color: cellColor } = await this.getCellColorInternal(pos);

        // Если клетка белая - превращаем в случайный цвет с новыми параметрами
        if (cellColor === '#ffffff') {
          // Генерируем новые параметры и цвет
          const newParams = generateCellParams(pos.x, pos.y);
          const newColor = paramsToColor(newParams, 0);
          
          // Обновляем клетку в MongoDB
          await this.cellModel.findOneAndUpdate(
            { key },
            {
              $set: {
                color: newColor,
                food: newParams.food,
                building: newParams.building,
                experience: newParams.experience,
                power: newParams.power,
                'playerProgress.whiteTaps': 0, // Сбрасываем счетчик
              },
            },
            { upsert: true },
          );
          
          affectedCells.push({ position: pos, color: newColor });
        }
      }
    }

    return { exploded: true, affectedCells };
  }

  // Обработка тапа по цветной клетке для сбора цвета
  async tapColorCell(
    clientId: string,
    pos: CellPosition,
  ): Promise<{
    collected: boolean;
    progress: number;
    required: number;
    color: CellColor;
    health: number;
    winnerId?: string;
    collectedAmount?: number;
    tapAmount?: number; // Количество натапанного за раз
    insufficientInventory?: boolean; // Флаг нехватки места в инвентаре
  }> {
    const player = await this.getOrCreatePlayer(clientId);
    if (!player) {
      return { collected: false, progress: 0, required: 0, color: '#000000', health: 0, tapAmount: 0 };
    }

    const { color: cellColor, params } = await this.getCellColorInternal(pos);
    if (cellColor === '#ffffff') {
      return { collected: false, progress: 0, required: 0, color: '#ffffff', health: 0, tapAmount: 0 };
    }

    // Проверяем, достаточно ли силы сбора для тапа
    // Клетку можно тапать, если её сила меньше чем collectionPower * (power/2 + stamina/2 - defense)
    const cellPower = params.power;
    const multiplier = (player.power / 2) + (player.stamina / 2) - (player.defense ?? 0);
    // Защита от отрицательного или слишком маленького множителя
    const safeMultiplier = Math.max(0.1, multiplier);
    // Максимальная сила клетки, которую может собрать игрок, не должна быть меньше 1
    const maxCellPower = Math.max(1, player.collectionPower * safeMultiplier);
    // Клетку можно собирать, если её сила меньше или равна максимальной силе игрока
    if (cellPower > maxCellPower) {
      // Недостаточно силы сбора - возвращаем текущее состояние
      const key = `${pos.x}:${pos.y}`;
      const health = await this.getOrInitCellHealth(pos);
      const cell = await this.cellModel.findOne({ key }).exec();
      const currentProgress = cell?.playerProgress?.[clientId] ?? 0;
      return {
        collected: false,
        progress: currentProgress,
        required: health,
        color: cellColor,
        health: health,
        tapAmount: 0, // Не тапали, так как недостаточно силы сбора
        insufficientInventory: false, // Проблема не в инвентаре, а в силе сбора
      };
    }

    // Проверяем, есть ли место в инвентаре для потенциального сбора
    // Проверяем минимальный вес (1 единица), чтобы убедиться, что хотя бы 1 единица поместится
    const minItemWeight = this.getItemWeightFromParams(params, 1);
    // Используем асинхронный метод, который учитывает параметры из БД
    const currentWeight = await this.getInventoryWeight(player.inventory);
    const maxWeight = this.getMaxInventoryWeight(player.weight, player.stamina);
    
    // Если даже минимальный вес (1 единица) не поместится, запрещаем тап
    if (currentWeight + minItemWeight > maxWeight) {
      // Нет места в инвентаре - возвращаем текущее состояние
      const key = `${pos.x}:${pos.y}`;
      const health = await this.getOrInitCellHealth(pos);
      const cell = await this.cellModel.findOne({ key }).exec();
      const currentProgress = cell?.playerProgress?.[clientId] ?? 0;
      return {
        collected: false,
        progress: currentProgress,
        required: health,
        color: cellColor,
        health: health,
        tapAmount: 0, // Не тапали, так как нет места в инвентаре
        insufficientInventory: true, // Флаг, что проблема в нехватке места
      };
    }

    // Проверяем, достаточно ли сытости для тапа
    // Трата сытости: сила сбора - (сила + выносливость + защита)/3
    const foodCost = Math.max(0, Math.ceil(player.collectionPower - (player.power + player.stamina + (player.defense ?? 0)) / 3));
    const roundedSatiety = Math.round(player.satiety);
    
    if (roundedSatiety < foodCost) {
      // Недостаточно сытости - возвращаем текущее состояние
      const key = `${pos.x}:${pos.y}`;
      const health = await this.getOrInitCellHealth(pos);
      const cell = await this.cellModel.findOne({ key }).exec();
      const currentProgress = cell?.playerProgress?.[clientId] ?? 0;
      return {
        collected: false,
        progress: currentProgress,
        required: health,
        color: cellColor,
        health: health,
        tapAmount: 0, // Не тапали, так как недостаточно сытости
        insufficientInventory: false, // Проблема не в инвентаре, а в сытости
      };
    }

    const key = `${pos.x}:${pos.y}`;
    
    // Получаем или создаем клетку с использованием upsert для избежания race condition
    const health = await this.getOrInitCellHealth(pos);
    let cell = await this.cellModel.findOneAndUpdate(
      { key },
      {
        $setOnInsert: {
          key,
          position: pos,
          color: cellColor,
          food: params.food,
          building: params.building,
          experience: params.experience,
          power: params.power,
          health,
          playerProgress: {},
        },
      },
      { upsert: true, new: true }
    ).exec();
    
    // Инициализируем здоровье, если нужно (для существующих клеток без здоровья)
    if (cell.health === undefined || cell.health === null) {
      cell.health = health;
      await cell.save();
    }
    
    // Тратим сытость за тап
    player.satiety = Math.max(0, Math.round(player.satiety - foodCost));
    
    // Увеличиваем счетчик съеденной еды
    player.totalFoodEaten = Math.round((player.totalFoodEaten ?? 0) + foodCost);
    
    // Проверяем увеличение веса при достижении порога сытости
    this.checkWeightIncrease(player);
    
    // Увеличиваем прогресс игрока на силу сбора
    const tapAmount = player.collectionPower; // Количество натапанного за раз
    const currentProgress = (cell.playerProgress[clientId] ?? 0) + tapAmount;
    
    // Уменьшаем жизни клетки на силу сбора
    const newHealth = (cell.health ?? health) - tapAmount;
    
    // Обновляем клетку в базе данных с использованием $set для правильного сохранения вложенных объектов
    await this.cellModel.findOneAndUpdate(
      { key },
      {
        $set: {
          [`playerProgress.${clientId}`]: currentProgress,
          health: newHealth,
        },
      },
    ).exec();
    
    // Обновляем локальный объект для дальнейшего использования
    cell.playerProgress[clientId] = currentProgress;
    cell.health = newHealth;
    
    let collectedAmount: number | undefined;
    let winnerId: string | undefined;
    let isCollected = false;
    
    // Если жизни <= 0, определяем победителя
    if (cell.health <= 0) {
      isCollected = true;
      
      // Находим игрока с наибольшим прогрессом
      let maxProgress = 0;
      
      for (const [playerId, progress] of Object.entries(cell.playerProgress)) {
        if (progress > maxProgress) {
          maxProgress = progress;
          winnerId = playerId;
        }
      }
      
      // Если победитель не найден, но есть прогресс, берем первого игрока из прогресса
      // (это может произойти, если клетка собрана одним игроком)
      if (!winnerId && Object.keys(cell.playerProgress).length > 0) {
        winnerId = Object.keys(cell.playerProgress)[0];
      }
      
      // Если есть победитель, отдаем клетку ему
      if (winnerId) {
        const winner = await this.getOrCreatePlayer(winnerId);
        if (winner) {
          // Вычисляем количество собранных единиц от 1 до 10 на основе удачи и уровня
          // Вероятность выпадения N = (удача / N * уровень игрока)
          collectedAmount = this.calculateCollectedAmount(winner.luck ?? 0, winner.level);
          
          // Проверяем ограничение по весу инвентаря
          // Используем асинхронный метод, который учитывает параметры из БД
          const currentWeight = await this.getInventoryWeight(winner.inventory);
          const maxWeight = this.getMaxInventoryWeight(winner.weight, winner.stamina);
          
          // Вычисляем вес добавляемых предметов
          const itemWeight = this.getItemWeightFromParams(params, collectedAmount);
          
          // Если добавление предметов превысит максимальный вес, не добавляем
          if (currentWeight + itemWeight > maxWeight) {
            // Не добавляем предметы, если превышен лимит веса
            // Сбрасываем collectedAmount, чтобы не отправлять событие анимации
            collectedAmount = undefined;
          } else {
            const hasColor = winner.inventory[cellColor] !== undefined && winner.inventory[cellColor] > 0;
            
            if (collectedAmount !== undefined && collectedAmount > 0) {
              let newCount: number;
              if (hasColor) {
                newCount = (winner.inventory[cellColor] ?? 0) + collectedAmount;
              } else {
                newCount = collectedAmount;
                if (!winner.unlockedColors.includes(cellColor)) {
                  winner.unlockedColors.push(cellColor);
                }
              }
              
              // Просто устанавливаем новое количество без проверки на превышение номера цвета
              winner.inventory[cellColor] = newCount;
              
              winner.totalCollected += collectedAmount;
            }
            
            // Логика открытия новых цветов
            const currentColors = winner.unlockedColors.length;
            const nextColor = BASE_COLORS[currentColors];
            const requiredForNext = currentColors * currentColors;
            
            if (
              nextColor &&
              winner.totalCollected >= requiredForNext &&
              !winner.unlockedColors.includes(nextColor)
            ) {
              winner.unlockedColors.push(nextColor);
              // Не добавляем цвет в инвентарь с количеством 0 - он добавится только при сборе
            }
            
            // Сохраняем изменения победителя только если предметы были добавлены
            await this.savePlayer(winner);
          }
        }
      }
      
      // Клетка становится белой и остается белой навсегда
      // Обновляем клетку в базе данных
      await this.cellModel.findOneAndUpdate(
        { key },
        {
          $set: {
            color: '#ffffff',
            health: undefined,
            playerProgress: {},
            food: 0,
            building: 0,
            experience: 0,
            power: 1,
            constructionPoints: 0,
          },
        },
      ).exec();
      
      // Обновляем локальный объект
      cell.color = '#ffffff';
      cell.health = undefined;
      cell.playerProgress = {};
      cell.food = 0;
      cell.building = 0;
      cell.experience = 0;
      cell.power = 1;
      cell.constructionPoints = 0;
    } else {
      // Если клетка не собрана, изменения уже сохранены через findOneAndUpdate выше
      // Не нужно вызывать save() еще раз, так как это может привести к race condition
    }
    
    // Сохраняем изменения игрока (сытость, вес, счетчик съеденной еды)
    await this.savePlayer(player);
    
    // Возвращаем результат с актуальными значениями
    return {
      collected: isCollected,
      progress: currentProgress,
      required: isCollected ? 0 : (cell.health ?? 0),
      color: isCollected ? '#ffffff' : cellColor,
      health: isCollected ? 0 : (cell.health ?? 0),
      winnerId,
      collectedAmount,
      tapAmount, // Количество натапанного за раз
      insufficientInventory: false, // По умолчанию места достаточно
    };
  }

  // Получить прогресс тапов для клетки
  async getColorCellProgress(clientId: string, pos: CellPosition): Promise<{
    progress: number;
    required: number;
    color: CellColor;
    health: number;
  }> {
    const player = await this.getOrCreatePlayer(clientId);
    if (!player) {
      return { progress: 0, required: 0, color: '#000000', health: 0 };
    }

    const { color: cellColor } = await this.getCellColorInternal(pos);
    if (cellColor === '#ffffff') {
      return { progress: 0, required: 0, color: '#ffffff', health: 0 };
    }

    const key = `${pos.x}:${pos.y}`;
    const health = await this.getOrInitCellHealth(pos);
    const cell = await this.cellModel.findOne({ key }).exec();
    const progress = cell?.playerProgress?.[clientId] ?? 0;

    return { progress, required: health, color: cellColor, health };
  }

  // Атака на другого игрока
  async attackPlayer(
    attackerId: string,
    targetId: string,
  ): Promise<{ success: boolean; damage: number; targetSatiety: number }> {
    const attacker = await this.getOrCreatePlayer(attackerId);
    const target = await this.getOrCreatePlayer(targetId);

    if (!attacker || !target) {
      return { success: false, damage: 0, targetSatiety: 0 };
    }

    // Нельзя атаковать самого себя
    if (attackerId === targetId) {
      return { success: false, damage: 0, targetSatiety: target.satiety };
    }

    // Вычисляем урон на основе силы атакующего
    const damage = attacker.power;

    // Отнимаем сытость у цели
    target.satiety = Math.max(0, Math.round(target.satiety - damage));

    // Сохраняем изменения цели
    await this.savePlayer(target);

    return {
      success: true,
      damage,
      targetSatiety: target.satiety,
    };
  }

  // Получить личный чат для позиции клетки
  async getLocalChat(pos: CellPosition): Promise<LocalChat | null> {
    const key = `${pos.x}:${pos.y}`;
    const localChat = await this.localChatModel.findOne({ key }).lean().exec();
    if (!localChat) return null;
    
    const participants = localChat.participants || [];
    if (participants.length === 0) return null;
    
    // Проверяем, что на клетке есть персонажи разных игроков
    const participantPlayers = await this.playerModel.find({ 
      id: { $in: participants } 
    }).lean().exec();
    
    // Получаем уникальные userId участников (игнорируем тех, у кого нет userId)
    const userIds = new Set<string>();
    for (const player of participantPlayers) {
      if (player.userId) {
        userIds.add(player.userId);
      }
    }
    
    // Если все участники принадлежат одному игроку (или у всех нет userId), не показываем чат
    if (userIds.size <= 1) {
      return null;
    }
    
    return {
      cellPosition: localChat.cellPosition,
      participants: participants,
      messages: (localChat.messages || []) as LocalChatMessage[],
    };
  }

  // Отправить сообщение в личный чат
  async addLocalChatMessage(
    clientId: string,
    pos: CellPosition,
    text: string,
  ): Promise<{ success: boolean; message?: LocalChatMessage }> {
    const player = await this.getOrCreatePlayer(clientId);
    if (!player) {
      return { success: false };
    }

    const key = `${pos.x}:${pos.y}`;
    
    // Получаем чат (не создаем новый, если его нет)
    const localChat = await this.localChatModel.findOne({ key }).exec();
    if (!localChat) {
      return { success: false };
    }

    // Проверяем, что игрок в чате
    if (!localChat.participants.includes(clientId)) {
      return { success: false };
    }

    // Проверяем, что на клетке есть персонажи разных игроков
    const participants = localChat.participants || [];
    if (participants.length === 0) {
      return { success: false };
    }
    
    const participantPlayers = await this.playerModel.find({ 
      id: { $in: participants } 
    }).lean().exec();
    
    // Получаем уникальные userId участников (игнорируем тех, у кого нет userId)
    const userIds = new Set<string>();
    for (const p of participantPlayers) {
      if (p.userId) {
        userIds.add(p.userId);
      }
    }
    
    // Если все участники принадлежат одному игроку (или у всех нет userId), не разрешаем отправку
    if (userIds.size <= 1) {
      return { success: false };
    }

    const message: LocalChatMessage = {
      id: randomUUID(),
      playerId: clientId,
      name: player.name,
      text: text.trim(),
      createdAt: Date.now(),
      cellPosition: pos,
    };

    // Добавляем сообщение
    localChat.messages.push(message);
    // Ограничиваем количество сообщений (последние 50)
    if (localChat.messages.length > 50) {
      localChat.messages = localChat.messages.slice(-50) as any;
    }
    
    await localChat.save();

    return { success: true, message };
  }

  // Получить участников чата для позиции
  async getLocalChatParticipants(pos: CellPosition): Promise<string[]> {
    const key = `${pos.x}:${pos.y}`;
    const chat = await this.localChatModel.findOne({ key }).lean().exec();
    return chat?.participants || [];
  }

  // Удалить игрока из чата (используется при отключении)
  async removePlayerFromLocalChat(clientId: string, pos: CellPosition): Promise<void> {
    const key = `${pos.x}:${pos.y}`;
    const chat = await this.localChatModel.findOne({ key }).exec();
    if (chat) {
      const index = chat.participants.indexOf(clientId);
      if (index > -1) {
        chat.participants.splice(index, 1);
        // Если чат пуст, удаляем его
        if (chat.participants.length === 0) {
          await this.localChatModel.deleteOne({ key });
        } else {
          await chat.save();
        }
      }
    }
  }

  // Сброс инвентаря на клетку, где стоит игрок
  async dropInventoryOnCell(
    clientId: string,
    color: CellColor,
    count: number,
  ): Promise<{ success: boolean; message?: string; constructionPoints?: number; constructionType?: number }> {
    const player = await this.getOrCreatePlayer(clientId);
    if (!player) {
      return { success: false, message: 'Игрок не найден' };
    }

    // Используем позицию игрока
    const position = player.position;
    const key = `${position.x}:${position.y}`;

    // Проверяем, что клетка белая или серая (строительный материал)
    const cell = await this.cellModel.findOne({ key }).exec();
    const cellColor = cell?.color ?? '#ffffff';
    const currentConstructionPoints = cell?.constructionPoints ?? 0;
    const currentConstructionType = cell?.constructionType;
    const isWhite = cellColor === '#ffffff';
    const isConstructionMaterial = currentConstructionPoints > 0;
    
    if (!isWhite && !isConstructionMaterial) {
      return { success: false, message: 'Можно сбрасывать только на белые клетки или клетки со строительным материалом' };
    }

    // Проверяем, что у игрока есть этот предмет в инвентаре
    const currentCount = player.inventory[color] ?? 0;
    if (currentCount < count) {
      return { success: false, message: 'Недостаточно предметов в инвентаре' };
    }

    // Вычисляем строительные очки на основе параметра building из сброшенного предмета
    // Нужно найти параметры клетки по цвету из инвентаря
    // Ищем клетку с таким цветом в БД для получения параметров
    let buildingPointsToAdd = 0;
    
    // Ищем любую клетку с таким цветом в БД для получения параметров
    const sampleCell = await this.cellModel.findOne({ 
      color,
      building: { $exists: true, $ne: undefined }
    }).exec();
    
    let itemBuilding = 0;
    let itemExperience = 0;
    let itemFood = 0;
    
    if (sampleCell && sampleCell.building !== undefined) {
      // Используем параметры из найденной клетки
      itemBuilding = sampleCell.building;
      itemExperience = sampleCell.experience ?? 0;
      itemFood = sampleCell.food ?? 0;
    } else {
      // Fallback: используем компоненты цвета
      const { r, g, b } = this.getRGBComponents(color);
      itemBuilding = r;
      itemExperience = b;
      itemFood = g;
    }

    // Вычисляем тип строительного материала: ceil(опыт / 10)
    const itemConstructionType = Math.ceil(itemExperience / 10);

    // Проверяем тип клетки, если это строительный материал
    if (isConstructionMaterial && currentConstructionType !== undefined) {
      if (itemConstructionType !== currentConstructionType) {
        return { success: false, message: `Можно сбрасывать только в клетку типа ${currentConstructionType}. Тип предмета: ${itemConstructionType}` };
      }
    }

    // Формула: кол-во которое нужно прибавить = кол-во строй очков - кол-во опыта клетки
    const pointsToAdd = Math.max(0, itemBuilding - itemExperience) * count;

    // Тип строительного материала устанавливается при первом сбросе или должен совпадать
    const newConstructionType = isWhite ? itemConstructionType : currentConstructionType;
    
    // Проверяем, что тип определен
    if (newConstructionType === undefined || newConstructionType === null) {
      return { success: false, message: 'Тип строительного материала не определен' };
    }
    
    // Максимальное значение строительных очков = constructionType * 255
    const maxConstructionPoints = newConstructionType * 255;
    
    // Строительные очки = сумма (building - experience) параметров сброшенных предметов
    // Ограничиваем максимальным значением для данного типа
    const newConstructionPoints = Math.min(maxConstructionPoints, currentConstructionPoints + pointsToAdd);

    // Удаляем предметы из инвентаря
    player.inventory[color] = currentCount - count;
    if (player.inventory[color] === 0) {
      delete player.inventory[color];
    }

    // Сохраняем игрока
    await this.savePlayer(player);

    // Обновляем клетку: устанавливаем параметры строительного материала
    // food=0, building=constructionPoints, experience=0, power=16 (для серых клеток)
    // health = building * 10
    const newParams: CellParams = {
      food: 0,
      building: newConstructionPoints,
      experience: 0,
      power: 16, // Серые клетки имеют силу 16
    };
    const newColor = paramsToColor(newParams, newConstructionPoints, newConstructionType);
    const newHealth = newConstructionPoints * 10; // Здоровье = building * 10

    await this.cellModel.findOneAndUpdate(
      { key },
      {
        $set: {
          color: newColor,
          food: 0,
          building: newConstructionPoints,
          experience: 0,
          power: 16,
          health: newHealth,
          constructionPoints: newConstructionPoints,
          constructionType: newConstructionType,
        },
      },
      { upsert: true },
    ).exec();

    return {
      success: true,
      constructionPoints: newConstructionPoints,
      constructionType: newConstructionType,
    };
  }

  // Получить все доступные постройки
  async getAllBuildings(): Promise<Array<{ name: string; structure: any[]; cellPower: number; cellHealth: number }>> {
    const buildings = await this.buildingModel.find().lean().exec();
    return buildings.map(b => ({
      name: b.name,
      structure: b.structure,
      cellPower: b.cellPower,
      cellHealth: b.cellHealth,
    }));
  }

  // Построить постройку
  async buildBuilding(
    clientId: string,
    buildingName: string,
  ): Promise<{ success: boolean; message?: string; affectedCells?: CellPosition[] }> {
    const player = await this.getOrCreatePlayer(clientId);
    if (!player) {
      return { success: false, message: 'Игрок не найден' };
    }

    // Получаем информацию о постройке
    const building = await this.buildingModel.findOne({ name: buildingName }).lean().exec();
    if (!building) {
      return { success: false, message: 'Постройка не найдена' };
    }

    const startPosition = player.position;
    const buildingId = randomUUID(); // Уникальный ID для этой постройки
    const affectedCells: CellPosition[] = [];

    // Проверяем каждую клетку структуры
    for (const struct of building.structure) {
      const cellPosition: CellPosition = {
        x: startPosition.x + struct.x,
        y: startPosition.y + struct.y,
      };
      const key = `${cellPosition.x}:${cellPosition.y}`;

      // Получаем клетку
      const cell = await this.cellModel.findOne({ key }).exec();
      if (!cell) {
        return { success: false, message: `Клетка ${key} не найдена` };
      }

      // Проверяем, что клетка является строительным материалом
      if (!cell.constructionPoints || cell.constructionPoints === 0) {
        return { success: false, message: `Клетка ${key} не является строительным материалом` };
      }

      // Проверяем тип строительного материала
      if (cell.constructionType === undefined || !struct.t.includes(cell.constructionType)) {
        return { success: false, message: `Клетка ${key} имеет неподходящий тип (${cell.constructionType}, требуется один из: ${struct.t.join(', ')})` };
      }

      // Проверяем минимальное количество строительных очков
      if (cell.constructionPoints < struct.a) {
        return { success: false, message: `Клетка ${key} имеет недостаточно строительных очков (${cell.constructionPoints}, требуется минимум ${struct.a})` };
      }

      // Проверяем, что клетка еще не является частью другой постройки
      if (cell.buildingName && cell.buildingName !== buildingName) {
        return { success: false, message: `Клетка ${key} уже является частью постройки "${cell.buildingName}"` };
      }

      affectedCells.push(cellPosition);
    }

    // Если все проверки пройдены, обновляем клетки
    for (const cellPosition of affectedCells) {
      const key = `${cellPosition.x}:${cellPosition.y}`;
      await this.cellModel.findOneAndUpdate(
        { key },
        {
          $set: {
            color: '#ff0000', // Красный цвет для построек
            power: building.cellPower,
            health: building.cellHealth,
            buildingName: building.name,
            buildingId: buildingId,
          },
        },
      ).exec();
    }

    // Обновляем счетчик построек у игрока
    const currentCount = player.buildings?.[buildingName] ?? 0;
    if (!player.buildings) {
      player.buildings = {};
    }
    player.buildings[buildingName] = currentCount + 1;
    await this.savePlayer(player);

    return { success: true, affectedCells };
  }

  // Регенерация белых клеток каждую минуту
  @Cron(CronExpression.EVERY_MINUTE)
  async regenerateWhiteCells(): Promise<void> {
    try {
      // Находим максимальный уровень игроков
      const players = await this.playerModel.find().lean().exec();
      const maxLevel = players.length > 0 
        ? Math.max(...players.map(p => p.level ?? 1))
        : 1;
      
      // Находим все белые клетки
      const whiteCells = await this.cellModel.find({ color: '#ffffff' }).lean().exec();
      
      // Регенерируем клетки с вероятностью 0.5
      const cellsToRegenerate: Array<{ key: string; position: CellPosition }> = [];
      for (const cell of whiteCells) {
        if (Math.random() < 0.5) {
          cellsToRegenerate.push({
            key: cell.key,
            position: cell.position,
          });
        }
      }
      
      // Генерируем новые параметры для выбранных клеток
      for (const cellInfo of cellsToRegenerate) {
        const params = generateCellParamsWithMinPower(
          cellInfo.position.x,
          cellInfo.position.y,
          maxLevel,
        );
        const color = paramsToColor(params, 0);
        const health = params.power * params.experience;
        
        await this.cellModel.findOneAndUpdate(
          { key: cellInfo.key },
          {
            $set: {
              color,
              food: params.food,
              building: params.building,
              experience: params.experience,
              power: params.power,
              health,
              playerProgress: {},
              constructionPoints: 0,
              constructionType: undefined,
              buildingName: undefined,
              buildingId: undefined,
            },
          },
        ).exec();
      }
      
      console.log(`Регенерировано ${cellsToRegenerate.length} клеток из ${whiteCells.length} белых клеток (макс. уровень: ${maxLevel})`);
    } catch (error) {
      console.error('Ошибка при регенерации клеток:', error);
    }
  }
}

