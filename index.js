const express = require('express');
const path = require('path')

const app = express();


app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => {
    res.send({ message: 'hello, world' });
});

app.use('/api', require('./inbound/router'));

module.exports = app;
