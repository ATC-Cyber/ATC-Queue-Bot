import "dotenv/config";
import { getRPSChoices } from "./game.js";
import { capitalize, InstallGlobalCommands } from "./utils.js";

// Get the game choices from game.js
function createCommandChoices() {
  const choices = getRPSChoices();
  const commandChoices = [];

  for (let choice of choices) {
    commandChoices.push({
      name: capitalize(choice),
      value: choice.toLowerCase(),
    });
  }

  return commandChoices;
}

// Get the queue choices from game.js
function createQueueChoices() {
  const choices = ["PvE", "PvP", "Campaign"];
  const commandChoices = [];

  for (let choice of choices) {
    commandChoices.push({
      name: capitalize(choice),
      value: choice,
    });
  }

  return commandChoices;
}



// Simple test command
const LFG_COMMAND = {
  name: "lfg",
  description: "Start a group",
  options: [
    {
      type: 3,
      name: "category",
      description: "Choose your group type",
      required: true,
      choices: [
        { name: "Dungeon", value: "Dungeon" },
        { name: "World Boss", value: "World Boss" },
        { name: "Helltide", value: "Helltide" },
        { name: "PvP", value: "PvP" },
        { name: "Campaign", value: "Campaign" },
        { name: "Stronghold", value: "Stronghold" },
        { name: "Capstone Dungeon", value: "Capstone Dungeon" },
        { name: "Tree of Whispers", value: "Tree of Whispers" },
        { name: "Other", value: "Other" },
      ],
    },
    {
      type: 4,
      name: "world-tier",
      description: "Select your World Tier",
      required: true,
      choices: [
        { name: "World Tier 1 (Normal)", value: "1" },
        { name: "World Tier 2 (Veteran)", value: "2" },
        { name: "World Tier 3 (Torment)", value: "3" },
        { name: "World Tier 4 (Hell)", value: "4" },
      ],
    },
    {
      type: 3,
      name: "title",
      description: "Enter a title for your group (optional)",
      required: false,
    },
    {
      type: 4,
      name: "group-size",
      description: "Select your group size",
      required: false,
      choices: [
        { name: "2", value: "2" },
        { name: "3", value: "3" },
        { name: "4", value: "4" },
      ],
    },
    {
      type: 3,
      name: "hardcore",
      description: "Is this a hardcore group?",
      required: false,
      choices: [
        { name: "Yes", value: 'true' },
        { name: "No", value: 'false' },
      ],
    },
    {
      type: 3,
      name: "notify-clubhouse",
      description: "Send a message to clubhouse-general stating that you are starting a group? (optional, default: Yes)",
      required: false,
      choices: [
        { name: "Yes", value: 'true' },
        { name: "No", value: 'false' },
      ],
    },
  ],
  type: 1,
};

const LFG_PINGS_COMMAND = {
  name: "lfgnotifications",
  description: "Disable recieveing queue notifications",
  options: [
    {
      type: 1,
      name: "disable",
      description: "Disable notifications",
      options: [
        {
          type: 3,
          name: "notification-type",
          description: "Select which notifications to disable",
          required: false,
          choices: [
            { name: "All", value: 'all' },
            { name: "Invites", value: 'invites' },
            { name: "Group Full", value: 'groupfull' },
          ],
        },
      ],
    },
    {
      type: 1,
      name: "enable",
      description: "Enable notifications",
      options: [
        {
          type: 3,
          name: "notification-type",
          description: "Select which notifications to enable",
          required: false,
          choices: [
            { name: "All", value: 'all' },
            { name: "Invites", value: 'invites' },
            { name: "Group Full", value: 'groupfull' },
          ],
        },
      ],
    },
  ],
  type: 1,
};

const BATTLENET_COMMAND = {
  name: "battlenet",
  description: "Manage BattleNet IDs",
  options: [
    {
      type: 1,
      name: "set",
      description: "Set your BattleNet ID",
      options: [
        {
          type: 3,
          name: "battlenet-id",
          description: "Enter your BattleNet ID",
          required: true,
        },
      ],
    },
    {
      type: 1,
      name: "view",
      description: "View someone's BattleNet ID",
      options: [
        {
          type: 6,
          name: "user",
          description: "Select a user",
          required: true,
        },
      ],
    },
  ],
  type: 1,
};

const ADMIN_BATTLENET_COMMAND = {
  name: "adminbattlenet",
  description: "Manage BattleNet IDs",
  options: [
    {
      type: 1,
      name: "set",
      description: "Set your BattleNet ID",
      options: [
        {
          type: 6,
          name: "user",
          description: "Select a user",
          required: true,
        },
        {
          type: 3,
          name: "battlenet-id",
          description: "Enter your BattleNet ID",
          required: true,
        },
      ],
    },
  ],
  type: 1,
};


const ALL_COMMANDS = [LFG_COMMAND, BATTLENET_COMMAND, ADMIN_BATTLENET_COMMAND, LFG_PINGS_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
