import 'dotenv/config';
import fetch from 'node-fetch';
import { verifyKey } from 'discord-interactions';

export function VerifyDiscordRequest(clientKey) {
  return function (req, res, buf, encoding) {
    const signature = req.get('X-Signature-Ed25519');
    const timestamp = req.get('X-Signature-Timestamp');

    const isValidRequest = verifyKey(buf, signature, timestamp, clientKey);
    if (!isValidRequest) {
      res.status(401).send('Bad request signature');
      throw new Error('Bad request signature');
    }
  };
}

export async function getLastMessage(channelId) {
  const endpoint = `channels/${channelId}/messages?limit=1`;
  const response = await DiscordRequest(endpoint);
  const messages = await response.json();
  if (messages.length > 0) {
    return messages[0];
  } else {
    return 'No messages found in the channel.';
  }
}

export async function getUsernameFromUserId(userId) {
  const endpoint = `users/${userId}`;
  const options = {
    method: 'GET',
  };

  try {
    const response = await DiscordRequest(endpoint, options);
    const user = await response.json();

    if (user.username) {
      const username = user.username;
      console.log(`Discord username: ${username}`);
      return username;
    } else {
      console.log('Username not found.');
      return null;
    }
  } catch (error) {
    console.error('Failed to fetch user information:', error);
    return null;
  }
}

export async function getBattleNetID(userId) {
  try {
    // Get the user's connections from Discord API
    const response = await DiscordRequest(`users/${userId}/connections`, { method: 'GET' });
    const connections = await response.json();

    // Find the BattleNet connection
    const battleNetConnection = connections.find(
      (connection) => connection.type === 'battle.net'
    );

    if (battleNetConnection) {
      // Extract the BattleNet ID
      const { id } = battleNetConnection;

      return id;
    } else {
      throw new Error('BattleNet account not connected.');
    }
  } catch (error) {
    console.error('Error retrieving BattleNet ID:', error);
    throw error;
  }
}


export async function DiscordRequest(endpoint, options) {
  // append endpoint to root API URL
  const url = 'https://discord.com/api/v10/' + endpoint;
  // Stringify payloads
  if (options.body) options.body = JSON.stringify(options.body);
  // Use node-fetch to make requests
  const res = await fetch(url, {
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': 'DiscordBot (https://github.com/discord/discord-example-app, 1.0.0)',
    },
    ...options
  });
  // throw API errors
  if (!res.ok) {
    const data = await res.json();
    console.log(res.status);
    throw new Error(JSON.stringify(data));
  }
  // return original response
  return res;
}

export async function InstallGlobalCommands(appId, commands) {
  // API endpoint to overwrite global commands
  const endpoint = `applications/${appId}/commands`;

  try {
    // This is calling the bulk overwrite endpoint: https://discord.com/developers/docs/interactions/application-commands#bulk-overwrite-global-application-commands
    await DiscordRequest(endpoint, { method: 'PUT', body: commands });
  } catch (err) {
    console.error(err);
  }
}


export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
