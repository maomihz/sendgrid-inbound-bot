const express = require('express');
const router = express.Router();

const config = require('../config/config');
const bot = require('./bot');

router.get(`/webhook`, (req, res) => {
    res.render('webhook.ejs');
});

router.post(`/webhook`, express.urlencoded({extended: false}), (req, res) => {
    if (req.body.webhook && req.body.token == config.token) {
        let webhook_url = `${req.body.webhook}/${req.body.token}`;
        bot.telegram.setWebhook(webhook_url).then(() => {
            res.status(200).send(webhook_url);
        });
    } else {
        res.status(403).end();
    }
});

router.use(bot.webhookCallback(`/webhook/${config.token}`));

module.exports = router;
