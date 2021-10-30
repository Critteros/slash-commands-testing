import path from 'path';
import fs from 'fs';
import { Client, Collection } from 'discord.js';
import { getLogger } from 'log4js';
import { readEnv } from './helpers';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import type { SlashCommandBuilder } from '@discordjs/builders';

import type { BotSlashCommand, BotEvent } from '../types/types';

type CreationParams = {
  token: string;
  clientId: string;
  guildId: string;
};

/**
 * Loads default export from all .js .ts files in given directory as a given generic type
 * @param dirname Directory name from which to load module data
 * @returns  Promise of given generic type
 */
const loadDataFromModules = async <T>(dirname: string): Promise<T[]> => {
  const logger = getLogger();
  logger.info(`Loading data from directory '${dirname}'`);
  const dirName = path.resolve(__dirname, dirname);
  const commandFiles = fs.readdirSync(dirName).filter((file) => file.endsWith('.ts') || file.endsWith('.js'));

  const data: T[] = [];

  for (const file of commandFiles) {
    const filePath = path.resolve(dirName, file);

    //Importing file as a module
    const module: any = await import(filePath);
    const moduleData: T = module.default;
    logger.info(`Loaded following data from module ${file} \n ${JSON.stringify(moduleData, null, 2)}`);
    data.push(module.default);
  }

  return data;
};

export class BotClient extends Client {
  private static _instance: BotClient | null = null;

  private static _intents: number[] = [];
  private _token: string = '';
  private _clientId: string = '';
  private _guildId: string = '';

  private commands = new Collection<string, BotSlashCommand>();
  private events = new Collection<string, BotEvent>();
  public logger = getLogger();

  /**
   * Constructs new BotClient object, this class is a singleton and only
   * one instance of this class can exist at once
   * @param params object of type CreationParams
   */
  private constructor(params: CreationParams) {
    super({ intents: BotClient._intents });
    this.logger.info('Creating new BotClient instance');

    ({ token: this._token, clientId: this._clientId, guildId: this._guildId } = params);
    this.loadEvents();
    this.loadSlashCommands();
  }

  /**
   * Loads and registers slash command to discord API
   */
  private async loadSlashCommands() {
    const logger = this.logger;

    logger.info(`Loading SlashCommands`);

    const commandsData: BotSlashCommand[] = await loadDataFromModules('slashCommands');
    const commands: SlashCommandBuilder[] = [];
    for (const command of commandsData) {
      logger.info(`Registering command '${command.data.name}'`);
      this.commands.set(command.data.name, command);
      commands.push(command.data);
    }

    const rest = new REST({ version: '9' }).setToken(this._token);

    //Register Guild Slash commands
    try {
      logger.info(`Registering following commands for guildId:${this._guildId}\n${JSON.stringify(commands, null, 2)}`);
      await rest.put(Routes.applicationGuildCommands(this._clientId, this._guildId), { body: commands });
      logger.info('Successfully registered guild slash commands.');
    } catch (error) {
      logger.error(`Could not register guild slash comamnds ${error}`);
    }

    //TODO register global slash commands

    //Interaction Handler
    this.on('interactionCreate', async (interaction) => {
      if (!interaction.isCommand()) return;

      const command = this.commands.get(interaction.commandName);
      if (!command) return;

      logger.info(`Dispaching slashcommand '${interaction.commandName}' in guild '${interaction.guildId}'`);
      try {
        await command.run(interaction);
      } catch (error) {
        console.error(error);
        await interaction.reply({
          content: `There was an error while executing  command '${command.data.name}'`,
          ephemeral: true,
        });
      }
    });
  }

  /**
   * Loads and register event handlers
   */
  private async loadEvents() {
    const logger = this.logger;
    logger.info(`Loading events`);

    const eventData: BotEvent[] = await loadDataFromModules('events');
    for (const event of eventData) {
      logger.info(`Loading event '${event.name}'`);
      this.events.set(event.name, event);

      if (event.once) {
        this.once(event.name, (...args) => event.run(...args));
      } else {
        this.on(event.name, (...args) => event.run(...args));
      }
    }
  }

  /**
   * Logins application to discord API
   * @returns Promise<string> discord secret token
   */
  public override login() {
    return super.login(this._token);
  }

  /**
   * Interface to get BotClient instance and create singleton if it doesn't exists
   * @returns BotClient instance
   */
  public static getClient(): BotClient {
    if (BotClient._instance === null) {
      BotClient._instance = new BotClient(readEnv());

      return BotClient._instance;
    }
    return BotClient._instance;
  }

  /**
   * Setter for BotClient discord api intents
   * @param intents array of intents to be passed to discord API
   */
  public static setIntents(intents: number[]): void {
    BotClient._intents = intents;
  }

  /**
   * Discord token getter
   * @returns discord secret token
   */
  public getToken(): string {
    return this._token;
  }

  /**
   * Client id getter
   * @returns client id
   */
  public getClientId(): string {
    return this._clientId;
  }

  /**
   * Guild id getter
   * @returns guild id
   */
  public getGuildId(): string {
    return this._guildId;
  }
}
