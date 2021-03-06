
/**
 * Module dependencies.
 */

var express = require('express')
  , http = require('http')
  , path = require('path')
  , olinapps = require('olinapps')
  , Imap = require('imap')
  , mailparser = require('mailparser')
  , mongojs = require('mongojs')
  , MongoStore = require('connect-mongo')(express)
  , async = require('async');

var app = express(), db;

app.configure(function () {
  db = mongojs(process.env.MONGOLAB_URI || 'olinapps-lists', ['sessions']);
  app.set('port', process.env.PORT || 3000);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.set('secret', process.env.SESSION_SECRET || 'terrible, terrible secret')
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.cookieParser(app.get('secret')));
  app.use(express.session({
    secret: app.get('secret'),
    store: new MongoStore({
      url: process.env.MONGOLAB_URI || 'mongodb://heroku_app12469168:pc9ga3k3n79fn1fjq92pfo8mp6@ds053937.mongolab.com:53937/heroku_app12469168'
    })
  }));
  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function () {
  app.set('host', 'localhost:3000');
  app.use(express.errorHandler());
});

app.configure('production', function () {
  app.set('host', 'lists.olinapps.com');
});

/**
 * IMAP
 */

var imap = new Imap({
  user: process.env.ARCHIVE_LOGIN,
  password: process.env.ARCHIVE_PASS,
  host: 'imap.gmail.com',
  port: 993,
  secure: true
}), box;

function openInbox (next) {
  imap.connect(function (err) {
    if (err) {
      console.error('Error connecting', err);
      process.exit(1);
    }
    next();
  });
}

function selectBox (box, next) {
  imap.openBox(box, true, function (err) {
    if (err) {
      console.error('Error connecting', err);
    }
    next();
  })
}

function searchMail (list, keywords, next) {
  selectBox('[Gmail]/All Mail', function () {
    imap.search([
      ['X-GM-LABELS', list],
      ['X-GM-RAW', keywords.join(' ')]
    ], function (err, results) {
      console.log(results.length);
      if (err) {
        next(null, []);
      } else {
        results = results.reverse();
        next(null, results); //originally sorted incorrectly by gmail
      }
    });
  });
}

function retrieveMail (results, each) {
  var count = 0, done = false;
  if (!results.length) {
    return each(null, null);
  }
  selectBox('[Gmail]/All Mail', function () {
    imap.fetch(results, { struct: false },
      { headers: { parse: false },
        body: true,
        cb: function (fetch) {
          fetch.on('message', function (msg) {
            //console.log('Checking message no. ' + msg.seqno);
            count++;

            var parser = new mailparser.MailParser();
            parser.on("end", function (obj) {
              text = obj.text;
              if (obj.alternatives && obj.alternatives.length) {
                obj.alternatives.forEach(function (alt) {
                  if (alt.contentType == 'text/plain') {
                    text = alt.content + text;
                  }
                });
              }

              var message = {
                seqno: msg.seqno,
                uid: msg.uid,
                subject: obj.subject,
                from: obj.from,
                to: obj.to,
                html: obj.html,
                text: text || (body && body.indexOf('_000_') > -1 ? '' : body),
                date: new Date(obj.headers.date)
              };

              each(null, message);

              count--;
              if (count <= 0 && done) {
                console.log('Done fetching all messages!');
                each(null, null);
              }
            });

            // Damn, old old messages have the wrong mime type entirely.
            // We patch this in our implementation.
            var body = null;
            msg.on('data', function (data) {
              if (body != null) {
                body += String(data);
              }
              if (body == null && String(data).match(/\r\n\r\n/)) {
                body = String(data).replace(/^[\s\S]*?\r\n\r\n/, '');
              }
            });

            // Forward data to mailparser.
            msg.on('data', function (data) {
              parser.write(data.toString());
            })
            msg.on('end', function (data) {
              parser.end();
            })
          });

          fetch.on('error', function (msg) {
            console.log(msg);
          })
        }
      }, function (err) {
        done = true;
        if (err) {
          each(null, null);
        };
        if (count == 0) {
          console.log('Done fetching some messages...');
          each(null, null);
        }
      }
    );
  });
}

function mailStream (ids, stream) {
  var first = true;
  stream.write('{"messages":[');
  retrieveMail(ids.reverse(), function (err, message) {
    if (!message) {
      stream.end(']}');
      console.log('Done streaming mail.');
      return;
    }
    if (!first) {
      stream.write(',');
    }
    first = false;
    stream.write(JSON.stringify(message));
  });
}

/**
 * Authentication
 */

app.post('/login', olinapps.login);
app.all('/logout', olinapps.logout);
app.all('/*', olinapps.middleware);
//app.all('/api/*', olinapps.loginRequired);
app.all('/*', olinapps.loginRequired);

/**
 * Routes
 */

app.get('/api/lists/:list', function (req, res) {
  searchMail(req.params.list, (req.query.text || '').split(/\s+/), function (err, ids) {
    var chunkSize = 100;
    var groups = [].concat.apply([],
      ids.map(function (elem, i) {
        return i % chunkSize ? [] : [ids.slice(i, i + chunkSize)];
      })
    ).map(function (arr) {
      return {
        ids: arr.map(Number),
        url: 'http://' + app.get('host') + '/api/messages?ids=' + arr.join(',') + '&sessionid=' + req.session.sessionid
      };
    });
    res.json({groups: groups});
  })
});


app.get('/api/messages/lists/:list', function (req, res) {
  searchMail(req.params.list, (req.query.text || '').split(/\s+/), function (err, ids) {
    var chunkSize = 100;
    var groups = chunk(ids, chunkSize);
    mailStream((groups[0] || []).map(Number), res);
  })
});


app.get('/api/messages', function (req, res) {
  var ids = req.query.ids ? req.query.ids.split(',') : [];
  mailStream(ids, res);
});

function chunk (arr, chunkLength) {
  var chunks = [],
      i = 0,
      n = arr.length;

  do
  {
    chunks.push(arr.slice(i, i += chunkLength));
  } while (i < n) 
  
  return chunks;
}
/**
 * Launch
 */
openInbox(function () {
  http.createServer(app).listen(app.get('port'), function(){
    console.log("Express server listening on http://" + app.get('host'));
  });
});