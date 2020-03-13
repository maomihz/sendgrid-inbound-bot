const { Telegram } = require("telegraf");

const token = process.env.TOKEN;

exports.chat = process.env.CHAT;
exports.telegram = new Telegram(token);
