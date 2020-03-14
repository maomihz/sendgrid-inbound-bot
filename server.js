const express = require('express');
const path = require('path');
const app = require('./index');
const config = require('./config/config');

app.use('/static', express.static(path.join(__dirname, 'static')));

app.listen(config.port, function() {
    console.log(`Listening on port ${config.port}...`);
});
