import { getLogger } from 'log4js';
import type { Message } from 'discord.js';

import { retriveMessageInfo } from './helpers';
import { ActivityGuildModel } from '../schema/activity';
import type { ActivityChildUsersType } from '../schema/activity';
import type { MessageInfo } from '../types/types';

//Logger to be used in this module
const logger = getLogger();

/**
 * Updates User Activity Score object and creates one if passed null
 * this function does not interact with a database
 * @param oldRecord old Record from database if null than new record will be constructed
 * @param messageInfo message info object for context reference
 * @returns updated record is returned
 */
const updateUserActivityRecordMessages = (
  oldRecord: ActivityChildUsersType | null,
  messageInfo: MessageInfo,
): ActivityChildUsersType => {
  //Create new record if old one does not exists
  if (!oldRecord) {
    const record: ActivityChildUsersType = {
      _id: messageInfo.userId,
      userName: messageInfo.userName,
      sendMessages: 1,
      xp: 10,
      voiceSeconds: 0,
    };
    return record;
  }
  //Handle username changes
  if (oldRecord.userName != messageInfo.userName) {
    logger.warn(
      `User changed his name from '${oldRecord.userName}' to ${messageInfo.userName} updating change in database'`,
    );
    oldRecord.userName = messageInfo.userName;
  }

  logger.debug(`Updating in databse user activity for user '${messageInfo.userId}' '${messageInfo.userName}'
    sendMessages: ${oldRecord.sendMessages} -> ${oldRecord.sendMessages + 1}    
    xp: ${oldRecord.xp} -> ${oldRecord.xp + 10} `);
  oldRecord.sendMessages += 1;
  oldRecord.xp += 10;
  return oldRecord;
};

/**
 * Updates and writes to database user activity score, this function does not prevent spam messages
 * @param message message that invoked activity update
 * @returns Promise<void>
 */
const updateActivityMessagesNoCheck = async (message: Message) => {
  const messageInfoObject = retriveMessageInfo(message);
  const { userId, userName, channelId, channelName } = messageInfoObject;

  //At this point it is guarenteed that context is guild message but we need to tell that to typescript
  const guildId = messageInfoObject.guildId ?? '';
  const guildName = messageInfoObject.guildName ?? '';

  logger.debug(`ACTIVITY INFO
    Registering activity of 
    user '${userId}' '${userName}' 
    in guild '${guildId}'  '${guildName}'
    channel '${channelId}' '${channelName}'`);

  //Check if database has record of this guild
  const queryResult = await ActivityGuildModel.findById(guildId);

  //Database do not have this guild
  if (!queryResult) {
    logger.debug(`No activity record found for guild '${guildId}' '${guildName}' creating new one`);
    const newRecord = new ActivityGuildModel({
      _id: guildId,
      guildName: guildName,
      users: [updateUserActivityRecordMessages(null, messageInfoObject)],
    });
    await newRecord.save();
    return;
  }

  //Check if user record is present
  const userRecord = queryResult.users.find((el) => el._id === userId);
  if (!userRecord) {
    logger.debug(`No activity record found for user '${userId}' '${userName}' creating new one`);
    queryResult.users.push(updateUserActivityRecordMessages(null, messageInfoObject));
    await queryResult.save();
    return;
  }

  updateUserActivityRecordMessages(userRecord, messageInfoObject);
  await queryResult.save();
};

interface UserContext {
  userId: string;
  guildId: string;
  channelId: string;
  timestamp: number;
}

const contexes: UserContext[] = [];

/**
 * Updates and writes to database user activity score
 * @param message message that invoked activity update
 * @returns Promise<void>
 */
export const updateActivityMessages = async (message: Message) => {
  const timeout = 2000;

  const findUserContext = (context: UserContext): UserContext | undefined => {
    return contexes.find((el) => {
      const checks: boolean[] = [
        el.channelId === context.channelId,
        el.guildId === context.guildId,
        el.userId === context.userId,
      ];

      return checks.every((el) => el === true);
    });
  };

  const messageInfo = retriveMessageInfo(message);
  const guildId = messageInfo.guildId ?? '';
  const { userId, channelId } = messageInfo;
  const timestamp = new Date().getTime();

  const userInteraction: UserContext = { guildId, userId, channelId, timestamp };

  const timeNow = new Date().getTime();
  const registered = findUserContext(userInteraction);

  if (!registered) {
    contexes.push(userInteraction);
    logger.info(`Registering and executing activity update`);
    await updateActivityMessagesNoCheck(message);
    return;
  }

  if (timeNow - registered.timestamp < timeout) {
    logger.info(`Throttling activity update`);
    return;
  }
  logger.info(`Executing activity update`);
  registered.timestamp = timeNow;
  await updateActivityMessagesNoCheck(message);
  return;
};