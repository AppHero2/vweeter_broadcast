var express       = require('express');
var path          = require('path');
var favicon       = require('serve-favicon');
var cookieParser  = require('cookie-parser');
var bodyParser    = require('body-parser');
var firebase      = require('firebase');
var vweeter       = require('./vweeter.js');

var routes        = require('./routes/index');

var app           = express();

console.log('initialize firebase')
var config = {
  apiKey: "AIzaSyBiRtlX1OIPZoN1uHvO4Qg1xNVqW4YlW4w",
  authDomain: "vweeter-187aa.firebaseapp.com",
  databaseURL: "https://vweeter-187aa.firebaseio.com",
  storageBucket: "<BUCKET>.appspot.com",
};
firebase.initializeApp(config);

vweeter(); // call vweeter

var http = require('https');
setInterval(function(){
  http.get('https://vweeter.herokuapp.com/');
},300000);

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'public')));

app.use('/', routes);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    console.log("Error message:"+err.message)
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  console.log("Error message:"+err.message);
  res.render('error', {
    message: err.message,
    error: {}
  });
});

module.exports = app;
