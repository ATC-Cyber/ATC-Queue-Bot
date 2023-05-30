import "dotenv/config";
import express from "express";
import {
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
  MessageComponentTypes,
  ButtonStyleTypes,
} from "discord-interactions";
import { VerifyDiscordRequest, DiscordRequest, getUsernameFromUserId, getBattleNetID } from "./utils.js";
import { getShuffledOptions, getResult } from "./game.js";
import fs from 'fs';


// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;
// Parse request body and verifies incoming requests using discord-interactions package
app.use(express.json({ verify: VerifyDiscordRequest(process.env.PUBLIC_KEY) }));

// Store for in-progress games. In production, you'd want to use a DB
const activeGames = {};

// Store for in-progress queues.
let activeQueues = {};

// Regex pattern for validating Battle.Net IDs
const battleNetIdRegex = /^[a-zA-Z][a-zA-Z0-9]{2,11}#[0-9]{4,5}$/;

const classEmoji = {
  "barbarian": `<:Barbarian:1113148921942921236>`,//
  "druid": `<:Druid:1113148950065721384>`,//
  "necromancer": `<:Necromancer:1113148977228034158>`,//
  "rogue": `<:Rogue:1113149001399795843>`,//
  "sorcerer": `<:Sorcerer:1113149025038905496>`//
}

const worldTierEmoji = [
  '<:WorldTier1:1112697426961244211>',
  '<:WorldTier2:1112697425820385300>',
  '<:WorldTier3:1112697424352391198>',
  '<:WorldTier4:1112697421886144533>'
]

const battleNetID = `<:BattleNetID:1112808993153351710> `;//

const hardcoreEmoji = '<:Hardcore:1112868532598882324>'

let voiceChannelsToKill = [];

const guildId = '1108065772909117470';
const channelId = '1112385490545561712';
const clubhouseChannelId = '1108065774079332475';

const voiceChannelCateogory = '1112540048928284812';

const adminList = ['107886804446781440', '490798938207551489', '413101637087920136', '945090003896238171', '485787584895647744',
                  '296649133387677697', '280719066157809666', '171372192200785921'];

const hardcoreImage = 'https://i.imgur.com/KbaziqF.png';

let battleNetIds = {};


// Function to check if a voice channel is empty
async function isVoiceChannelEmpty(channelId) {
  return true;
  const endpoint = `/channels/${channelId}/`;
  const response = await DiscordRequest(endpoint, { method: 'GET' });
  const data = await response.json();

  if (response.ok && data.type === 2) {
    // Voice channel fetched successfully
    const memberCount = data.members.length;
    return memberCount === 0;
  } else {
    // Error fetching the voice channel
    throw new Error('Failed to fetch voice channel information');
  }
}

async function decrementQueueTimeLeft() {
  
  for (let i = 0; i < voiceChannelsToKill.length; i++) {
    const channelId = voiceChannelsToKill[i];
    if (channelId == null) {continue;}
    if (await isVoiceChannelEmpty(channelId)) {
        // Delete voice channel
        const voiceChannelEndpoint = `channels/${channelId}`;
        DiscordRequest(voiceChannelEndpoint, { method: 'DELETE' })
          .catch(err => {
            console.error('Error deleting voice channel:', err);
          });
        voiceChannelsToKill[i] = null;
    }
  }
    
  
  // Iterate over each queue object
  for (const queueId in activeQueues) {

    // Decrement timeLeft by 60 seconds
    activeQueues[queueId].timeLeft -= 1;
    
    /*const embed = {
      title: `${activeQueues[queueId].header}`,
      description: `### ${activeQueues[queueId].title}\nPlease use the **Join Group** button below to sign-up.\n### Current participants (${activeQueues[queueId].players.length}/${activeQueues[queueId].groupSize})\n ${getCurrentParticipantsString(queueId)}### Click here to join the voice chat:\n <#${
        activeQueues[queueId].voiceChannelId
      }>\nYou can set your Battle.net ID with \`/battlenet set\``,
      color: 0xc8b290,
      thumbnail: {
        url: activeQueues[queueId].worldTierImage,
      },
      image: {
        url: activeQueues[queueId].imgUrl,
        height: 0,
        width: 0,
      },
      footer: {
        text: `Powered by: Ashava Trophy Club Group Finder © 2023 | ${activeQueues[queueId].timeLeft} minutes left.`,
      },
    };*/
    
    const embed = getGroupEmbed(queueId);
    
    if  (activeQueues[queueId].channelId && activeQueues[queueId].messageId) {
      const endpoint = `/channels/${activeQueues[queueId].channelId}/messages/${activeQueues[queueId].messageId}`;

      DiscordRequest(endpoint, {
        method: "PATCH",
        body: {
          content: "",
          embeds: [embed],
        },
      })
    }
    
    saveQueuesToFile();

    // Check if timeLeft is less than or equal to 0
    if (activeQueues[queueId].timeLeft <= 0) {
      
      // Delete message
      const messageEndpoint = `/channels/${activeQueues[queueId].channelId}/messages/${activeQueues[queueId].messageId}`;
      DiscordRequest(messageEndpoint, { method: 'DELETE' })
        .catch(err => {
          console.error('Error deleting message:', err);
        });

      if (activeQueues[queueId].voiceChannelId) {
        if (isVoiceChannelEmpty(activeQueues[queueId].voiceChannelId)) {
          // Delete voice channel
          const voiceChannelEndpoint = `channels/${activeQueues[queueId].voiceChannelId}`;
          DiscordRequest(voiceChannelEndpoint, { method: 'DELETE' })
            .catch(err => {
              console.error('Error deleting voice channel:', err);
            });
        } else {
          // Try again in a minute
          voiceChannelsToKill.push(activeQueues[queueId].voiceChannelId);
        }
      }

      // Remove the queue from activeQueues
      delete activeQueues[queueId];
      saveQueuesToFile();
    }
  }
}

// Call the function every 60 seconds
setInterval(decrementQueueTimeLeft, 60000);

function getClassIcon(className) {
  return classEmoji[className];
}

function getCurrentParticipantsString(queueId) {
  let currentParticipants = "";

  activeQueues[queueId].players.forEach((playerObject) => {
    let classIcon = classEmoji['barbarian'];

    activeQueues[queueId].classes.forEach((element) => {
      if (element.player == playerObject.id) {
        classIcon = getClassIcon(element.class);
      }
    });
    
    if (battleNetIds[playerObject.id]) {
      currentParticipants += `${classIcon} <@${playerObject.id}> - ${battleNetID}${battleNetIds[playerObject.id]}\n`;
    } else {
      currentParticipants += `${classIcon} <@${playerObject.id}>\n`;
    }
    
  });

  return currentParticipants;
}

function getRequestedClassesString(queueId) {
  
  if (!activeQueues[queueId].requestedClasses) {
    return '';
  }
  
  if (activeQueues[queueId].requestedClasses.length == 0) {
    return '';
  }
  
  let outputString = "\n**Looking for:**\n";
  
  activeQueues[queueId].requestedClasses.forEach(characterClass => {
                                            const formattedClassName = `${characterClass.charAt(0).toUpperCase() + characterClass.slice(1)}`;
                                            outputString += `${getClassIcon(characterClass)} ${formattedClassName}, `;
  });
  outputString = outputString.slice(0, -2);
  outputString += `\n`;
  return outputString;
}

function getGroupEmbed(queueId) {
  
    const embed = {
      title: `${activeQueues[queueId].header}`,
      description: `### ${activeQueues[queueId].title}\nPlease use the **Join Group** button below to sign-up.
                    ${getRequestedClassesString(queueId)}
                    **Current participants (${activeQueues[queueId].players.length}/${activeQueues[queueId].groupSize})**
                    ${getCurrentParticipantsString(queueId)}### Click here to join the voice chat:\n <#${activeQueues[queueId].voiceChannelId}>\n
                    You can set your Battle.net ID with \`/battlenet set\``,
      color: 0xc8b290,
      thumbnail: {
        url: activeQueues[queueId].worldTierImage,
      },
      image: {
        url: activeQueues[queueId].imgUrl,
        height: 0,
        width: 0,
      },
      footer: {
        text: `Powered by: Ashava Trophy Club Group Finder © 2023 | ${activeQueues[queueId].timeLeft} minutes left.`,
      },
    };
  


  return embed;
}

async function loadQueuesFromFile() {
  const queuesFilePath = 'data/queues.json';

  fs.readFile(queuesFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Failed to read Queues from file:', err);
    } else {
      try {
        activeQueues = JSON.parse(data);
        console.log('Queues loaded from file:', queuesFilePath);
      } catch (error) {
        console.error('Failed to parse Queues JSON:', error);
      }
    }
  });
}

async function createTemporaryVoiceChannel(name, guild_id, maxSlots) {
  const endpoint = `/guilds/${guild_id}/channels`;
  const options = {
    method: "POST",
    body: {
      name: `${name}`,
      type: 2, // Voice channel
      parent_id: voiceChannelCateogory,
      //bitrate: 64000, // Voice channel bitrate (optional)
      user_limit: maxSlots, // Maximum number of users allowed (optional)
    },
  };

  try {
    const response = await DiscordRequest(endpoint, options);
    const newVoiceChannel = await response.json();
    return newVoiceChannel.id; // Return the channel ID
  } catch (error) {
    console.error("Error creating temporary voice channel:", error.message);
    return null; // Return null in case of an error
  }
}

async function saveQueuesToFile() {
    // Write the queue to the file
    const queuesFilePath = 'data/queues.json';
    let queuesData = JSON.stringify(activeQueues, null, 2);
  
    if (queuesData === null) {
      queuesData = '{}';
    }

    fs.writeFile(queuesFilePath, queuesData, (err) => {
      if (err) {
        console.error('Failed to write queues to file:', err);
      } else {
        console.log('Queues saved to file:', queuesFilePath);
      }
    });
}

async function saveBattleNetIdsToFile() {
  // Write the battleNetIds dictionary to the file
  const battleNetIdsFilePath = 'data/battlenet.json';
  const battleNetIdsData = JSON.stringify(battleNetIds, null, 2);

  fs.writeFile(battleNetIdsFilePath, battleNetIdsData, (err) => {
    if (err) {
      console.error('Failed to write BattleNet IDs to file:', err);
    } else {
      console.log('BattleNet IDs saved to file:', battleNetIdsFilePath);
    }
  });
}

// Load the BattleNet IDs from the file (optional)
function loadBattleNetIdsFromFile() {
  const battleNetIdsFilePath = 'data/battlenet.json';

  fs.readFile(battleNetIdsFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Failed to read BattleNet IDs from file:', err);
    } else {
      try {
        battleNetIds = JSON.parse(data);
        console.log('BattleNet IDs loaded from file:', battleNetIdsFilePath);
      } catch (error) {
        console.error('Failed to parse BattleNet IDs JSON:', error);
      }
    }
  });
}

async function deleteGroup(queueId) {
    const queue = activeQueues[queueId];
      // Delete message
      const messageEndpoint = `/channels/${queue.channelId}/messages/${queue.messageId}`;
      DiscordRequest(messageEndpoint, { method: 'DELETE' })
        .catch(err => {
          console.error('Error deleting message:', err);
        });

      if (queue.voiceChannelId) {
        if (await isVoiceChannelEmpty(queue.voiceChannelId)) {
          // Delete voice channel
          const voiceChannelEndpoint = `channels/${queue.voiceChannelId}`;
          DiscordRequest(voiceChannelEndpoint, { method: 'DELETE' })
            .catch(err => {
              console.error('Error deleting voice channel:', err);
            });
        } else {
          // Try again in a minute
          voiceChannelsToKill.push(queue.voiceChannelId);
        }
      }

      // Remove the queue from activeQueues
      delete activeQueues[queueId];
      saveQueuesToFile();
}

// Handler for the "adminbattlenet" command
async function handleAdminBattleNetCommand(req, res) {
  const { options } = req.body.data;
  const subcommand = options[0]?.name;
  
  const userId = req.body.member.user.id;
  if (!adminList.includes(userId)) {
    return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "You are not an admin, sorry.",
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      });
  }

  if (subcommand === "set") {
    const selectedUser = options[0]?.options?.[0]?.value;
    const battleNetId = options[0]?.options?.[1]?.value;
    
    // Validate the Battle.Net ID using the regex pattern
    if (!battleNetIdRegex.test(battleNetId)) {
      res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "Invalid Battle.Net ID format. Please provide a valid Battle.Net ID.",
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      });
      return; // Return early if the Battle.Net ID is invalid
    }
    
    // Store the BattleNet ID in the dictionary
    battleNetIds[selectedUser] = battleNetId;

    saveBattleNetIdsToFile();

    res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          // Fetches a random emoji to send from a helper function
          content: `Successfully set the BattleNet ID for user: <@${selectedUser}> to ${battleNetID}**${battleNetId}**`,
          // Indicates it'll be an ephemeral message
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      });
  }
}

/*const clubhouseEmbed = {
          title: `${activeQueues[id].host.username} has created a ${activeQueues[id].queueType} group.`,
          description: `Click here to check it out and join: https://discord.com/channels/${guildId}/${channelId}/${message.id}`,
          color: 0xc8b290,
          //thumbnail: {
          // url: activeQueues[id].worldTierImage,
          //},
          author: 
            { name: 'ATC Group Finder', 
              icon_url: activeQueues[id].worldTierImage,
            }
        };
      
        // Send a message into the clubhouse
        const clubHouseResponse = await DiscordRequest(`channels/${clubhouseChannelId}/messages`, {
          method: 'POST',
          body: {
            // Fetches a random emoji to send from a helper function
            content: "",
            embeds: [clubhouseEmbed],
          },
        });*/

async function sendInvite(to, from, queueId){
  
  if (disabledInviteNotifications.includes(to)) {
    return;
  }
  
  const endpoint = `users/@me/channels`;
  const options = {
    method: 'POST',
    body: {
      recipient_id: to
    }
  };

  // Create a channel with the user
  const channelRes = await DiscordRequest(endpoint, options);
  const channelData = await channelRes.json();
  
  const clubhouseEmbed = {
          title: `${activeQueues[queueId].host.username} has invited you to their ${activeQueues[queueId].queueType} group.`,
          description: `Click here to check it out and join: https://discord.com/channels/${guildId}/${channelId}/${activeQueues[queueId].messageId}`,
          color: 0xc8b290,
          //thumbnail: {
          // url: activeQueues[id].worldTierImage,
          //},
          author: 
            { name: 'ATC Group Finder', 
              icon_url: activeQueues[queueId].worldTierImage,
            }
        };

  // Send the direct message
  const sendMessageEndpoint = `channels/${channelData.id}/messages`;
  const sendMessageOptions = {
    method: 'POST',
    body: {
      content: "",
      embeds: [clubhouseEmbed],
    }
  };

  const messageRes = await DiscordRequest(sendMessageEndpoint, sendMessageOptions);
  const messageData = await messageRes.json();

  return messageData;
}

async function sendGroupFullDM(to, queueId){
  
  if (disabledGroupFullNotifications.includes(to)) {
    return;
  }
  
  const endpoint = `users/@me/channels`;
  const options = {
    method: 'POST',
    body: {
      recipient_id: to
    }
  };

  // Create a channel with the user
  const channelRes = await DiscordRequest(endpoint, options);
  const channelData = await channelRes.json();
  
  const messageEmbed = {
    title: `${activeQueues[queueId].title} is now full! `,
    description: `https://discord.com/channels/${guildId}/${channelId}/${activeQueues[queueId].messageId}\nHop in voice and best of luck! <#${activeQueues[queueId].voiceChannelId}>`,
    color: 0xc8b290,
    //thumbnail: {
    // url: activeQueues[id].worldTierImage,
    //},
    author: 
      { name: 'ATC Group Finder', 
        icon_url: activeQueues[queueId].worldTierImage,
      }
  };

  // Send the direct message
  const sendMessageEndpoint = `channels/${channelData.id}/messages`;
  const sendMessageOptions = {
    method: 'POST',
    body: {
      content: "",
      embeds: [messageEmbed],
    }
  };

  const messageRes = await DiscordRequest(sendMessageEndpoint, sendMessageOptions);
  const messageData = await messageRes.json();

  return messageData;
}

let disabledGroupFullNotifications = [];
let disabledInviteNotifications = [];

async function handleLfgNotificationsCommand(req, res) {
  const { options } = req.body.data;
  
  const subcommand = options[0]?.name;
  
  const userId = req.body.member.user.id;

  if (subcommand === "disable") {
    const name = options[0]?.options?.[0]?.name;
    const selectedType = options[0]?.options?.[0]?.value;
    
    switch (selectedType) {
      case 'all':
        if (!disabledInviteNotifications.includes(userId)) {
          disabledInviteNotifications.push(userId);
        }
        if (!disabledGroupFullNotifications.includes(userId)) {
          disabledGroupFullNotifications.push(userId);
        }
      case 'invites':
        if (!disabledInviteNotifications.includes(userId)) {
          disabledInviteNotifications.push(userId);
        }
      case 'groupfull':
        if (!disabledGroupFullNotifications.includes(userId)) {
          disabledGroupFullNotifications.push(userId);
        }
      default:
        break;
    }
    
    saveDisabledInviteNotificationsToFile();
    saveDisabledGroupFullNotificationsToFile();
    
    res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          // Fetches a random emoji to send from a helper function
          content: `You have successfully disabled ${selectedType} notifications.`,
          // Indicates it'll be an ephemeral message
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      });
  }
  if (subcommand === "enable") {
    const name = options[0]?.options?.[0]?.name;
    const selectedType = options[0]?.options?.[0]?.value;
    
    switch (selectedType) {
      case 'all':
        let newArray = [];
        for (let i = 0; i < disabledInviteNotifications.length; i++) {
          if (disabledInviteNotifications[i] != userId) {
            newArray.push(disabledInviteNotifications[i]);
          }
        }
        disabledInviteNotifications = newArray;
        let newArray2 = [];
        for (let i = 0; i < disabledGroupFullNotifications.length; i++) {
          if (disabledGroupFullNotifications[i] != userId) {
            newArray.push(disabledGroupFullNotifications[i]);
          }
        }
        disabledGroupFullNotifications = newArray2;
      case 'invites':
        let newArray3 = [];
        for (let i = 0; i < disabledInviteNotifications.length; i++) {
          if (disabledInviteNotifications[i] != userId) {
            newArray.push(disabledInviteNotifications[i]);
          }
        }
        disabledInviteNotifications = newArray3;
      case 'groupfull':
        let newArray4 = [];
        for (let i = 0; i < disabledGroupFullNotifications.length; i++) {
          if (disabledGroupFullNotifications[i] != userId) {
            newArray.push(disabledGroupFullNotifications[i]);
          }
        }
        disabledGroupFullNotifications = newArray4;
      default:
        break;
    }
    
    saveDisabledInviteNotificationsToFile();
    saveDisabledGroupFullNotificationsToFile();
    
    res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          // Fetches a random emoji to send from a helper function
          content: `You have successfully enabled ${selectedType} notifications.`,
          // Indicates it'll be an ephemeral message
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      });
  }
}


async function saveDisabledGroupFullNotificationsToFile() {
  // Write the disabledGroupFullNotifications dictionary to the file
  const disabledGroupFullNotificationsFilePath = 'data/disabledGroupFullNotifications.json';
  const disabledGroupFullNotificationsData = JSON.stringify(disabledGroupFullNotifications, null, 2);

  fs.writeFile(disabledGroupFullNotificationsFilePath, disabledGroupFullNotificationsData, (err) => {
    if (err) {
      console.error('Failed to write disabledGroupFullNotifications to file:', err);
    } else {
      console.log('BattleNet IDs saved to file:', disabledGroupFullNotificationsFilePath);
    }
  });
}

// Load the disabledGroupFullNotification from the file
function loadDisabledGroupFullNotificationsFromFile() {
  const disabledGroupFullNotificationsFilePath = 'data/disabledGroupFullNotifications.json';

  fs.readFile(disabledGroupFullNotificationsFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Failed to read disabledGroupFullNotifications from file:', err);
    } else {
      try {
        disabledGroupFullNotifications = JSON.parse(data);
        console.log('disabledGroupFullNotifications loaded from file:', disabledGroupFullNotificationsFilePath);
      } catch (error) {
        console.error('Failed to parse disabledGroupFullNotifications JSON:', error);
      }
    }
  });
}

async function saveDisabledInviteNotificationsToFile() {
  // Write the disabledGroupFullNotifications dictionary to the file
  const disabledInviteNotificationsFilePath = 'data/disabledInviteNotifications.json';
  const disabledInviteNotificationsData = JSON.stringify(disabledInviteNotifications, null, 2);

  fs.writeFile(disabledInviteNotificationsFilePath, disabledInviteNotificationsData, (err) => {
    if (err) {
      console.error('Failed to write disabledInviteNotifications to file:', err);
    } else {
      console.log('BattleNet IDs saved to file:', disabledInviteNotificationsFilePath);
    }
  });
}

// Load the saveDisabledInviteNotifications from the file
function loadDisabledInviteNotificationsFromFile() {
  const disabledInviteNotificationsFilePath = 'data/disabledInviteNotifications.json';

  fs.readFile(disabledInviteNotificationsFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Failed to read disabledInviteNotifications from file:', err);
    } else {
      try {
        disabledInviteNotifications = JSON.parse(data);
        console.log('disabledInviteNotifications loaded from file:', disabledInviteNotificationsFilePath);
      } catch (error) {
        console.error('Failed to parse disabledInviteNotifications JSON:', error);
      }
    }
  });
}

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 */
app.post("/interactions", async function (req, res) {
  // Interaction type and data
  const { type, id, data, guild_id } = req.body;

  /**
   * Handle verification requests
   */
  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  /**
   * Handle slash command requests
   * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
   */
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name, options } = data;
    
    // "adminbattlenet" command
    if (name === "adminbattlenet") {
      // Handle the adminbattlenet command logic here
      await handleAdminBattleNetCommand(req, res);
      return; // Return early after handling the command
    }
    
    // "lfgnotifications" command
    if (name === "lfgnotifications") {
      // Handle the adminbattlenet command logic here
      await handleLfgNotificationsCommand(req, res);
      return; // Return early after handling the command
    }
    
    // "battlenet" command
    if (name === "battlenet") {
      const subcommand = options[0]?.name;

      if (subcommand === "set") {
        // Handle the battlenet set logic here
        const battleNetId = options[0]?.options?.[0]?.value;
        const userId = req.body.member.user.id;
        
          // Validate the Battle.Net ID using the regex pattern
          if (!battleNetIdRegex.test(battleNetId)) {
            res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: "Invalid Battle.Net ID format. Please provide a valid Battle.Net ID.",
                flags: InteractionResponseFlags.EPHEMERAL,
              },
            });
            return; // Return early if the Battle.Net ID is invalid
          }
        

        // Store the BattleNet ID in the dictionary
        battleNetIds[userId] = battleNetId;
        
        saveBattleNetIdsToFile();
        
        res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              // Fetches a random emoji to send from a helper function
              content: `Your Battle.net ID was set to: ${battleNetID}**${battleNetId}**\n*If it does not display on the group roster please just leave and re-join the group.*`,
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });

        return; // Return early after handling the subcommand
      }

      if (subcommand === "view") {
        // Handle the battlenet view logic here
        const userId = options[0]?.options?.[0]?.value;
        const battleNetId = battleNetIds[userId];
        
        if (battleNetId) {
          res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                // Fetches a random emoji to send from a helper function
                content: `<@${userId}>'s Battle.net ID is: ${battleNetID}**${battleNetId}**`,
                // Indicates it'll be an ephemeral message
                flags: InteractionResponseFlags.EPHEMERAL,
              },
            });
        } else {
          res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                // Fetches a random emoji to send from a helper function
                content: `<@${userId}> has not set their Battle.net ID\nThey can set it by using \`/battlenet set [Their ID]\``,
                // Indicates it'll be an ephemeral message
                flags: InteractionResponseFlags.EPHEMERAL,
              },
            });
        }

        return; // Return early after handling the subcommand
      }
    }

    // "lfg" command
    if (name === "lfg") {
      if (activeQueues.length >= 50) {
        try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              // Fetches a random emoji to send from a helper function
              content: "Apologies. Cannot create event as there are too many voice channels current active.\nPlease ask an admin to delete some.",
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        } catch (err) {
          console.error("Error sending message:", err);
        }
        return;
      }
      const user = req.body.member.user;
      const userId = req.body.member.user.id;
      const userName = req.body.member.user.username;

      // User's queue choice

      let queueType = null;
      let worldTier = 1;
      let worldTierImage = 'https://i.imgur.com/yP97q2Z.png';
      let title = null;
      let groupSize = 4;
      let hardcore = false;

      let description = null;
      
      let notifyClubhouse = true;

      req.body.data.options.forEach((option) => {
        if (option.name == "category") {
          queueType = option.value;
        }
        if (option.name == "world-tier") {
          worldTier = option.value;
        }
        if (option.name == "title") {
          title = option.value;
        }
        if (option.name == "group-size") {
          groupSize = option.value;
        }
        if (option.name == "hardcore") {
         hardcore = option.value == 'true';
        }
        if (option.name == "notify-clubhouse") {
          notifyClubhouse = option.value == 'true'
        }
      });

      switch (worldTier) {
        case 1:
          worldTierImage = 'https://i.imgur.com/yP97q2Z.png';
          break
        case 2:
          worldTierImage = 'https://i.imgur.com/2kkKzK8.png';
          break
        case 3:
          worldTierImage = 'https://i.imgur.com/cXeuoBG.png';
          break
        case 4:
          worldTierImage = 'https://i.imgur.com/kiPlFwa.png';
          break
        default:
          worldTierImage = 'https://i.imgur.com/yP97q2Z.png';
          break
      }

      if (title == null) {
        title = `${user.username}'s ${queueType} group`;
      }
      
      if (title.length > 100) {
        await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              // Fetches a random emoji to send from a helper function
              content: "Sorry, your title must be less than 100 characters.",
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        return;
      }

      let imgUrl = `https://i.imgur.com/odjrcqP.png`;
      
      switch (queueType) {
        case "Dungeon":
          imgUrl = "https://i.imgur.com/ZdveMfG.png";//
          break;
        case "World Boss":
          imgUrl = "https://i.imgur.com/5pdW23n.png";//
          break;
        case "Helltide":
          imgUrl = "https://i.imgur.com/fDvH9Xd.png";//
          break;
        case "PvP":
          imgUrl = "https://i.imgur.com/RwyWZn7.png";//
          break;
        case "Campaign":
          imgUrl = "https://i.imgur.com/QibVBzX.png";//
          break;
        case "Stronghold":
          imgUrl = "https://i.imgur.com/xgDE0vd.png";//
          break;
        case "Capstone Dungeon":
          imgUrl = "https://i.imgur.com/j4Rczo4.png";//
          break;
        case "Tree of Whispers":
          imgUrl = "https://i.imgur.com/trvIozE.png";//
          break;
        case "Other":
          imgUrl = "https://i.imgur.com/Se2dWIy.png";//
          break;
        case "Nightmare Dungeon":
          imgUrl = "https://i.imgur.com/j4Rczo4.png";//
        default:
          imgUrl = `https://i.imgur.com/Se2dWIy.png`;
          break;
      }
      
      let hardcoreText = '';
      if (hardcore) {
        hardcoreText = 'Hardcore ';
        if (title == `${user.username}'s ${queueType} group`){
          title = `${user.username}'s Hardcore ${queueType} group`;
        }
      }

      // Create active queue using message ID as the queue ID
      activeQueues[id] = {
        id: userId,
        messageId: null,
        channelId: channelId,
        bodyId: req.body.id,
        host: req.body.member.user,
        players: [],
        classes: [],
        queueType: queueType,
        voiceChannelId: null,
        title: title,
        description: `\n### World-tier ${worldTier}`,
        worldTier: `World Tier ${worldTier}`,
        header: `${user.username} has started a ${hardcoreText}${queueType} group!`,
        timeLeft: 120,
        imgUrl: imgUrl,
        groupSize: groupSize,
        worldTierImage: worldTierImage,
        hardcore: hardcore,
        requestedClasses: []
      };

      activeQueues[id].players.push(req.body.member.user);

      const voiceChannelId = await createTemporaryVoiceChannel(
        `🎤${activeQueues[id].title} VC`,
        guild_id,
        groupSize
      );

      activeQueues[id].voiceChannelId = voiceChannelId;

      const date = new Date();

      /*const embed = {
        title: `${activeQueues[id].header}`,
        description: `### ${activeQueues[id].title}\nPlease use the **Join Group** button below to sign-up.\n### Current participants (${activeQueues[id].players.length}/${activeQueues[id].groupSize})\n ${getCurrentParticipantsString(
          id
        )}### Click here to join the voice chat:\n <#${
          activeQueues[id].voiceChannelId
        }>\nYou can set your Battle.net ID with \`/battlenet set\``,
        color: 0xc8b290,
        thumbnail: {
          url: activeQueues[id].worldTierImage,
        },
        image: {
          url: activeQueues[id].imgUrl,
          height: 0,
          width: 0,
        },
        footer: {
          text: `Powered by: Ashava Trophy Club Group Finder © 2023 | ${activeQueues[id].timeLeft} minutes left.`,
        },
      };*/
      
      const embed = getGroupEmbed(id);
      

      // Send a message into the channel where command was triggered from
      const response = await DiscordRequest(`channels/${channelId}/messages`, {
        method: 'POST',
        body: {
          // Fetches a random emoji to send from a helper function
          content: "",
          embeds: [embed],
          components: [
            {
              type: MessageComponentTypes.ACTION_ROW,
              components: [
                {
                  type: MessageComponentTypes.BUTTON,
                  // Append the queue ID to use later on
                  custom_id: `join_button_${req.body.id}`,
                  label: "Join Group",
                  style: ButtonStyleTypes.SUCCESS,
                  emoji: {
                    id: '1113106544125550683',
                    name: 'addaccount'
                  }
                },
                {
                  type: MessageComponentTypes.BUTTON,
                  // Append the queue ID to use later on
                  custom_id: `leave_button_${req.body.id}`,
                  label: "Leave Group",
                  style: ButtonStyleTypes.DANGER,
                  emoji: {
                    id: '1113106545136386210',
                    name: 'removeaccount'
                  }
                },
                {
                  type: MessageComponentTypes.BUTTON,
                  // Append the queue ID to use later on
                  custom_id: `select_class_${req.body.id}`,
                  label: "Select Class",
                  style: ButtonStyleTypes.PRIMARY,
                  emoji: {
                    id: '1113108019195150487',
                    name: 'classselect'
                  }
                },

              ],
            },
            {
              type: MessageComponentTypes.ACTION_ROW,
              components: [
                {
                  type: MessageComponentTypes.BUTTON,
                  // Append the queue ID to use later on
                  custom_id: `invite_player_${req.body.id}`,
                  label: "Invite Someone",
                  style: ButtonStyleTypes.SECONDARY,
                },
                {
                  type: MessageComponentTypes.BUTTON,
                  // Append the queue ID to use later on
                  custom_id: `request_classes_${req.body.id}`,
                  label: "Request Class",
                  style: ButtonStyleTypes.SECONDARY,
                },
                {
                  type: MessageComponentTypes.BUTTON,
                  // Append the queue ID to use later on
                  custom_id: `delete_button_${req.body.id}`,
                  label: "Delete Group",
                  style: ButtonStyleTypes.SECONDARY,
                  emoji: {
                    id: null,
                    name: "🗑️",
                  },
                },
              ],
            },
          ],
        },
      });
      
      const message = await response.json();
      activeQueues[id].messageId = message.id;
      
      saveQueuesToFile();
      
      if (notifyClubhouse) {
        const clubhouseEmbed = {
          title: `${activeQueues[id].host.username} has created a ${activeQueues[id].queueType} group.`,
          description: `Click here to check it out and join: https://discord.com/channels/${guildId}/${channelId}/${message.id}`,
          color: 0xc8b290,
          //thumbnail: {
          // url: activeQueues[id].worldTierImage,
          //},
          author: 
            { name: 'ATC Group Finder', 
              icon_url: activeQueues[id].worldTierImage,
            }
        };
      
        // Send a message into the clubhouse
        const clubHouseResponse = await DiscordRequest(`channels/${clubhouseChannelId}/messages`, {
          method: 'POST',
          body: {
            // Fetches a random emoji to send from a helper function
            content: "",
            embeds: [clubhouseEmbed],
          },
        });
      }
      

      

      
      try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `### You have successfully created a ${activeQueues[id].queueType} group. https://discord.com/channels/${guildId}/${channelId}/${message.id}\nA voice chat has been created for your group <#${activeQueues[id].voiceChannelId}>\nPlease select your class from the dropdown below.`,
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
              components: [
                {
                  type: 1,
                  components: [
                    {
                      type: 3,
                      custom_id: `class_select_${activeQueues[id].bodyId}`,
                      options: [
                        {
                          label: "Barbarian",
                          value: "barbarian",
                          description: "",
                          emoji: {//
                            name: "Barbarian",
                            id: "1113148921942921236",
                          },
                        },
                        {
                          label: "Druid",
                          value: "druid",
                          description: "",
                          emoji: {//
                            name: "Druid",
                            id: "1113148950065721384",
                          },
                        },
                        {
                          label: "Necromancer",
                          value: "necromancer",
                          description: "",
                          emoji: {
                            name: "Necromancer",
                            id: "1113148977228034158",
                          },
                        },
                        {
                          label: "Rogue",
                          value: "rogue",
                          description: "",
                          emoji: {//
                            name: "Rogue",
                            id: "1113149001399795843",
                          },
                        },
                        {
                          label: "Sorcerer",
                          value: "sorcerer",
                          description: "",
                          emoji: {//
                            name: "Sorcerer",
                            id: "1113149025038905496",
                          },
                        },
                      ],
                      placeholder: "Choose a class",
                      min_values: 1,
                      max_values: 1,
                    },
                  ],
                },
              ],
            },
          });
        } catch (err) {
          console.error("Error sending message:", err);
        }
  }
  }

  /**
   * Handle requests from interactive components
   * See https://discord.com/developers/docs/interactions/message-components#responding-to-a-component-interaction
   */
  if (type === InteractionType.MESSAGE_COMPONENT) {
    // custom_id set in payload when sending message component
    const componentId = data.custom_id;

    if (componentId.startsWith("edit_button_")) {
      // get the associated queue ID
      const queueId = componentId.replace("edit_button_", "");
      // Delete message with token in request body
      const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message.id}`;
      const userId = req.body.member.user.id;

      if (userId == activeQueues[queueId].host.id) {
        await res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            // Fetches a random emoji to send from a helper function
            content: "Use the below buttons to edit your queue.",
            // Indicates it'll be an ephemeral message
            flags: InteractionResponseFlags.EPHEMERAL,
            components: [
              {
                type: MessageComponentTypes.ACTION_ROW,
                components: [
                  {
                    type: MessageComponentTypes.BUTTON,
                    // Append the queue ID to use later on
                    custom_id: `title_button_${req.body.id}`,
                    label: "Edit Title",
                    style: ButtonStyleTypes.SECONDARY,
                  },
                  {
                    type: MessageComponentTypes.BUTTON,
                    // Append the queue ID to use later on
                    custom_id: `desc_button_${req.body.id}`,
                    label: "Edit Description",
                    style: ButtonStyleTypes.SECONDARY,
                  },
                  {
                    type: MessageComponentTypes.BUTTON,
                    // Append the queue ID to use later on
                    custom_id: `delete_queue_${req.body.id}`,
                    label: "Delete Queue",
                    style: ButtonStyleTypes.SECONDARY,
                    emoji: {
                      id: null,
                      name: "🗑️",
                    },
                  },
                ],
              },
            ],
          },
        });
      } else {
        try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              // Fetches a random emoji to send from a helper function
              content: "You may not edit someone elses queue.",
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        } catch (err) {
          console.error("Error sending message:", err);
        }
      }
    }

    if (componentId.startsWith("delete_button_")) {
      // get the associated queue ID
      const queueId = componentId.replace("delete_button_", "");
      // Delete message with token in request body
      const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message.id}`;
      const userId = req.body.member.user.id;
      
      const { roles } = req.body.member.user;
      console.log(req.body.member.user);
      
      if (userId == activeQueues[queueId].host.id || adminList.includes(userId)) {
        try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              // Fetches a random emoji to send from a helper function
              content: "You have successfully deleted your queue.",
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
          // Delete previous message
          await DiscordRequest(endpoint, { method: "DELETE" });

          // Delete the voice channel
          const voiceChannelId = await activeQueues[queueId].voiceChannelId;
          DiscordRequest(`channels/${voiceChannelId}`, {
            method: "DELETE",
          });
          
          delete activeQueues[queueId];
          
          saveQueuesToFile();
        } catch (err) {
          console.error("Error sending message:", err);
        }
      } else {
        try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              // Fetches a random emoji to send from a helper function
              content: "You may not delete someone elses queue.",
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        } catch (err) {
          console.error("Error sending message:", err);
        }
      }
    }

    if (componentId.startsWith("leave_button_")) {
      // get the associated queue ID
      const queueId = componentId.replace("leave_button_", "");
      // Delete message with token in request body
      const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message.id}`;
      const user = req.body.member.user;

      let isPlayerInGroup = false;
      if (activeQueues[queueId].players) {
        activeQueues[queueId].players.forEach((player) => {
          if (player.id === user.id) {
            isPlayerInGroup = true;
          }
        });
      }

      if (isPlayerInGroup) {
        try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              // Fetches a random emoji to send from a helper function
              content: `You have successfully left <@${activeQueues[queueId].host.id}>'s queue.`,
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });

          let newListOfPlayers = [];
          activeQueues[queueId].players.forEach((player) => {
            if (player.id != user.id) {
              newListOfPlayers.push(player);
            }
          });
          activeQueues[queueId].players = newListOfPlayers;

          const date = new Date();

          /*const embed = {
            title: `${activeQueues[queueId].header}`,
            description: `### ${activeQueues[queueId].title
            }\nPlease use the **Join Group** button below to sign-up.\n### Current participants (${activeQueues[queueId].players.length}/${activeQueues[queueId].groupSize})\n ${getCurrentParticipantsString(
              queueId
            )}### Click here to join the voice chat:\n <#${
              activeQueues[queueId].voiceChannelId
            }>\nYou can set your Battle.net ID with \`/battlenet set\``,
            color: 0xc8b290,
            thumbnail: {
              url: activeQueues[queueId].worldTierImage,
            },
            image: {
              url: activeQueues[queueId].imgUrl,
              height: 0,
              width: 0,
            },
            footer: {
              text: `Powered by: Ashava Trophy Club Group Finder © 2023 | ${activeQueues[queueId].timeLeft} minutes left.`,
            },
          };*/
          
          const embed = getGroupEmbed(queueId);

          await DiscordRequest(endpoint, {
            method: "PATCH",
            body: {
              content: "",
              embeds: [embed],
            },
          });
        } catch (err) {
          console.error("Error sending message:", err);
        }
        
        if (activeQueues[queueId].players == 0) {
          deleteGroup(queueId);
        }
      } else {
        try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              // Fetches a random emoji to send from a helper function
              content: "You are not in this queue.",
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        } catch (err) {
          console.error("Error sending message:", err);
        }
      }
    }
    
    if (componentId.startsWith("request_classes_")) {
      const queueId = componentId.replace("request_classes_", "");
      const user = req.body.member.user;
      
      if (user.id != activeQueues[queueId].host.id) {
        try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              // Fetches a random emoji to send from a helper function
              content: "Sorry, you may not request classes for someone elses group.\nPlease ask the group host to request them.",
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        } catch (err) {
          console.error("Error sending message:", err);
        }
      } else {
        try {
          await res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `Please select all the classes you are looking for`,
                // Indicates it'll be an ephemeral message
                flags: InteractionResponseFlags.EPHEMERAL,
                components: [
                  {
                    type: 1,
                    components: [
                      {
                        type: 3,
                        custom_id: `class_request_${activeQueues[queueId].bodyId}`,
                        options: [
                          {
                            label: "Barbarian",
                            value: "barbarian",
                            description: "",
                            emoji: {//
                              name: "Barbarian",
                              id: "1113148921942921236",
                            },
                          },
                          {
                            label: "Druid",
                            value: "druid",
                            description: "",
                            emoji: {//
                              name: "Druid",
                              id: "1113148950065721384",
                            },
                          },
                          {
                            label: "Necromancer",
                            value: "necromancer",
                            description: "",
                            emoji: {
                              name: "Necromancer",
                              id: "1113148977228034158",
                            },
                          },
                          {
                            label: "Rogue",
                            value: "rogue",
                            description: "",
                            emoji: {//
                              name: "Rogue",
                              id: "1113149001399795843",
                            },
                          },
                          {
                            label: "Sorcerer",
                            value: "sorcerer",
                            description: "",
                            emoji: {//
                              name: "Sorcerer",
                              id: "1113149025038905496",
                            },
                          },
                        ],
                        placeholder: "Choose a class",
                        min_values: 1,
                        max_values: 5,
                      },
                    ],
                  },
                ],
              },
            });
        } catch (err) {
          console.error("Error sending class request message:", err);
        }
      }
    }

    if (componentId.startsWith("join_button_")) {
      // get the associated queue ID
      const queueId = componentId.replace("join_button_", "");

      const user = req.body.member.user;

      let isPlayerInGroup = false;
      activeQueues[queueId].players.forEach((player) => {
        if (player.id === user.id) {
          //console.log(`${player.id} = ${user.id}`);
          isPlayerInGroup = true;
        }
      });

      // Delete message with token in request body
      const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message.id}`;

      if (isPlayerInGroup) {
        try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              // Fetches a random emoji to send from a helper function
              content: `You are already signed up for this queue.`,
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        } catch (err) {
          console.error("Error sending message:", err);
        }
      } else {
        if (activeQueues[queueId].players.length >= activeQueues[queueId].groupSize) {
          try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              // Fetches a random emoji to send from a helper function
              content: `This group is sadly full.\nPlease consider starting your own using \`/lfg\``,
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
          } catch (err) {
            console.error("Error sending message:", err);
          }
          return;
        }
        activeQueues[queueId].players.push(req.body.member.user);
        

        //console.log(`${req.body.member.user.username} joined`);
        try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `You have successfully joined ${activeQueues[queueId].host.username}'s ${activeQueues[queueId].queueType} queue.\n### A voice chat has been created for your group <#${activeQueues[queueId].voiceChannelId}>`,
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
              components: [
                {
                  type: 1,
                  components: [
                    {
                      type: 3,
                      custom_id: `class_select_${activeQueues[queueId].bodyId}`,
                      options: [
                        {
                          label: "Barbarian",
                          value: "barbarian",
                          description: "",
                          emoji: {//
                            name: "Barbarian",
                            id: "1113148921942921236",
                          },
                        },
                        {
                          label: "Druid",
                          value: "druid",
                          description: "",
                          emoji: {//
                            name: "Druid",
                            id: "1113148950065721384",
                          },
                        },
                        {
                          label: "Necromancer",
                          value: "necromancer",
                          description: "",
                          emoji: {
                            name: "Necromancer",
                            id: "1113148977228034158",
                          },
                        },
                        {
                          label: "Rogue",
                          value: "rogue",
                          description: "",
                          emoji: {//
                            name: "Rogue",
                            id: "1113149001399795843",
                          },
                        },
                        {
                          label: "Sorcerer",
                          value: "sorcerer",
                          description: "",
                          emoji: {//
                            name: "Sorcerer",
                            id: "1113149025038905496",
                          },
                        },
                      ],
                      placeholder: "Choose a class",
                      min_values: 1,
                      max_values: 1,
                    },
                  ],
                },
              ],
            },
          });
        } catch (err) {
          console.error("Error sending message:", err);
        }
        let currentParticipants = "";

        activeQueues[queueId].players.forEach((player) => {
          currentParticipants += `<@${player.id}>\n`;
        });

        const date = new Date();


        /*const embed = {
          title: `${activeQueues[queueId].header}`,
          description: `### ${activeQueues[queueId].title}\nPlease use the **Join Group** button below to sign-up.\n### Current participants (${activeQueues[queueId].players.length}/${activeQueues[queueId].groupSize})\n ${getCurrentParticipantsString(
            queueId
          )}### Click here to join the voice chat: <#${
            activeQueues[queueId].voiceChannelId
          }>\nYou can set your Battle.net ID with \`/battlenet set\``,
          color: 0xc8b290,
          thumbnail: {
            url: activeQueues[queueId].worldTierImage,
          },
          image: {
            url: activeQueues[queueId].imgUrl,
            height: 0,
            width: 0,
          },
          footer: {
            text: `Powered by: Ashava Trophy Club Group Finder © 2023 | ${activeQueues[queueId].timeLeft} minutes left.`,
          },
        };*/
        
        const embed = getGroupEmbed(queueId);

        await DiscordRequest(endpoint, {
          method: "PATCH",
          body: {
            content: "",
            embeds: [embed],
          },
        });
        
        if(activeQueues[queueId].players.length == activeQueues[queueId].groupSize) {
          
          activeQueues[queueId].players.forEach(playerObject => {
            sendGroupFullDM(playerObject.id, queueId);
          })
        }        
      }
    }

    if (componentId.startsWith("select_class_")) {
      // get the associated queue ID
      const queueId = componentId.replace("select_class_", "");
      // Delete message with token in request body
      const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message.id}`;
      const userId = req.body.member.user.id;

      try {
        await res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            // Fetches a random emoji to send from a helper function
            content: ``,
            // Indicates it'll be an ephemeral message
            flags: InteractionResponseFlags.EPHEMERAL,
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 3,
                    custom_id: `class_select_${activeQueues[queueId].bodyId}`,
                    options: [
                      {
                          label: "Barbarian",
                          value: "barbarian",
                          description: "",
                          emoji: {//
                            name: "Barbarian",
                            id: "1113148921942921236",
                          },
                        },
                        {
                          label: "Druid",
                          value: "druid",
                          description: "",
                          emoji: {//
                            name: "Druid",
                            id: "1113148950065721384",
                          },
                        },
                        {
                          label: "Necromancer",
                          value: "necromancer",
                          description: "",
                          emoji: {
                            name: "Necromancer",
                            id: "1113148977228034158",
                          },
                        },
                        {
                          label: "Rogue",
                          value: "rogue",
                          description: "",
                          emoji: {//
                            name: "Rogue",
                            id: "1113149001399795843",
                          },
                        },
                        {
                          label: "Sorcerer",
                          value: "sorcerer",
                          description: "",
                          emoji: {//
                            name: "Sorcerer",
                            id: "1113149025038905496",
                          },
                        },
                    ],
                    placeholder: "Choose a class",
                    min_values: 1,
                    max_values: 1,
                  },
                ],
              },
            ],
          },
        });
      } catch (err) {
        console.error("Error sending message:", err);
      }
    }
    
    if (componentId.startsWith("class_request_")) {
      const queueId = componentId.replace("class_request_", "");
      const queueMessageId = activeQueues[queueId].messageId;
      
      const endpoint = `/channels/${channelId}/messages/${queueMessageId}`;
      
      const requestedClasses = data.values;
      activeQueues[queueId].requestedClasses = requestedClasses;
      
      saveQueuesToFile();
      
      const embed = getGroupEmbed(queueId);

      await DiscordRequest(endpoint, {
        method: "PATCH",
        body: {
          content: "",
          embeds: [embed],
        },
      });
      
      let requestedClassesString = '';
      
      requestedClasses.forEach(characterClass => {
        
        let formattedClassName = `${characterClass.charAt(0).toUpperCase() + characterClass.slice(1)}`;
        requestedClassesString += `\n${getClassIcon(characterClass)}${formattedClassName}`;
      })
      
      // Update the original message
      res.send({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: {
          content: `You requested:${requestedClassesString}`,
          components: null,
        },
      });
    }

    if (componentId.startsWith("class_select_")) {
      // get the associated queue ID

      const queueId = componentId.replace("class_select_", "");
      const queueMessageId = activeQueues[queueId].messageId;

      // Delete message with token in request body
      const endpoint = `/channels/${channelId}/messages/${queueMessageId}`;
      const userId = req.body.member.user.id;
      const className = data.values[0];

      let classIcon = getClassIcon(className);

      let Chevron = `<:Chevron:1112474001369989142>`;
      
      let isPlayerAlreadyRegistered = false;
      
      activeQueues[queueId].classes.forEach(element => {
        if (element.player == userId) {
          element.class = className;
          element.classIcon = classIcon;
          isPlayerAlreadyRegistered = true;
        }
      })

      if (!isPlayerAlreadyRegistered) {
        activeQueues[queueId].classes.push({
          player: userId,
          class: className,
          classIcon: classIcon,
        });
      }


      const formattedClassName = `${
        className.charAt(0).toUpperCase() + className.slice(1)
      }`;

      //const emoji = `<:${formattedClassName}:${classEmojiId}>`;

      // Update the original message
      res.send({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: {
          content: `Selected: ${classIcon}${formattedClassName}`,
          components: null,
        },
      });
      
      let newRequestedClasses = [];
      // REMOVE CLASS FROM REQUESTED CLASSES
      for (let i = 0; i < activeQueues[queueId].requestedClasses.length; i++){
          if (activeQueues[queueId].requestedClasses[i] != className) {
            newRequestedClasses.push(activeQueues[queueId].requestedClasses[i]);
          }
      }
      activeQueues[queueId].requestedClasses = newRequestedClasses;
      
      saveQueuesToFile();

      const date = new Date();

      /*const embed = {
        title: `${activeQueues[queueId].header}`,
        description: `### ${activeQueues[queueId].title}\nPlease use the **Join Group** button below to sign-up.\n### Current participants (${activeQueues[queueId].players.length}/${activeQueues[queueId].groupSize})\n ${getCurrentParticipantsString(
          queueId
        )}### Click here to join the voice chat:\n <#${
          activeQueues[queueId].voiceChannelId
        }>\nYou can set your Battle.net ID with \`/battlenet set\``,
        color: 0xc8b290,
        thumbnail: {
          url: activeQueues[queueId].worldTierImage,
        },
        image: {
          url: activeQueues[queueId].imgUrl,
          height: 0,
          width: 0,
        },
        footer: {
          text: `Powered by: Ashava Trophy Club Group Finder © 2023 | ${activeQueues[queueId].timeLeft} minutes left.`,
        },
      };*/
      
      const embed = getGroupEmbed(queueId);

      await DiscordRequest(endpoint, {
        method: "PATCH",
        body: {
          content: "",
          embeds: [embed],
        },
      });
    }
    if (componentId.startsWith("invite_player_")) {
      // get the associated queue ID

      const queueId = componentId.replace("invite_player_", "");
      
      const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message.id}`;
      const userId = req.body.member.user.id;
      
      if (userId != activeQueues[queueId].host.id) {
        try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              // Fetches a random emoji to send from a helper function
              content: "Sorry, you may not invite someone to someone elses group.\nPlease ask the group host to invite them.",
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        } catch (err) {
          console.error("Error sending message:", err);
        }
      } else {

        try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              // Fetches a random emoji to send from a helper function
              content: ``,
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
              components: [
                {
                  type: 1,
                  components: [
                    {
                      type: 5,
                      custom_id: `invite_selection_${activeQueues[queueId].bodyId}`,
                      placeholder: "Select who to invite, you can invite up to 3 people at a time",
                      min_values: 1,
                      max_values: 3,
                    },
                  ],
                },
              ],
            },
          });
        } catch (err) {
          console.error("Error sending message:", err);
        }
      }
    }
    
    if (componentId.startsWith("invite_selection_")) {
      // get the associated queue ID

      const queueId = componentId.replace("invite_selection_", "");
      
      const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message.id}`;
      const userId = req.body.member.user.id;
      
      const invitedPlayers = data.values;
      
      let listOfInviteesString = '';
      
      for (let i = 0; i < invitedPlayers.length; i++) {
        listOfInviteesString += `<@${invitedPlayers[i]}>, `
      }
      
      listOfInviteesString = listOfInviteesString.slice(0, -2);
      
      invitedPlayers.forEach (player => {
        sendInvite(player, userId, queueId);
      })

      try {
        await res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            // Fetches a random emoji to send from a helper function
            content: `You sent an invite to: ${listOfInviteesString}`,
            // Indicates it'll be an ephemeral message
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      } catch (err) {
        console.error("Error sending message:", err);
      }
    }
  }
});

app.listen(PORT, () => {
  console.log("Listening on port", PORT);
  loadQueuesFromFile();
  loadBattleNetIdsFromFile();
  loadDisabledInviteNotificationsFromFile();
  loadDisabledGroupFullNotificationsFromFile()
});
