
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
  , MongoStore = require('connect-mongo')(express);

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
      url: process.env.MONGOLAB_URI || 'mongodb://localhost/olinapps-lists'
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


/*
def getEmail(uid):
    typ, data = app.mail.fetch(uid, '(RFC822)')
    return messageToDict(email.message_from_string(data[0][1]) ) 


def messageToDict(msg):
    '''
    Simple dict with body,subject,date to make passing to frontend easy and independent 
    of parsing and sanitization.
    BODY: a list of paragraphs, trimmed, stripped and filtered
    SUBJECT: raw subject
    DATE: raw date
    '''
    if not msg:
        return {"body":"ERROR","subject":"ERROR","date":"ERROR"}
    return {"body" : re.sub("^(\s*\r\n){2,}",'\r\n',getBody(msg)).split('\r\n'),
            "subject" : msg["subject"],
            "date" : msg.get('date')
            }


def getSlices(data):
    '''
    Simple helper to iterate through a list in pairs of two. Expects an even length data
    '''
    for i in range(len(data)/2):
        yield data[i*2:(i*2) + 2]

def getEmailBatch(emailIds):
    '''
    Reduces number of requests via IMAP by constructing one large one, containing
    comma seperated id args, parses and returns all messages specified by emailIds. 
    '''
    if not emailIds or len(emailIds) <= 0:
        return []

    try:
        t1 = time.time()
        res = {}
        queryString = ','.join([numail for numail in emailIds])
        typ, data = app.mail.fetch(queryString, '(RFC822 X-GM-THRID)')
        for d in getSlices(data): #data comes as two by two tuples, [0][1] contains raw data
            msg = email.message_from_string(d[0][1]) 
            m = re.match(r'.*X-GM-THRID (\d+) .*',d[0][0])
            threadId = -1
            if m:
                threadId = m.group(1)

            if not threadId in res:
                res[threadId] = []

            res[threadId].append(
                {"body" : getBody(msg).split('\r\n'),
                 "subject" : msg["subject"],
                 "date" : msg.get('date'),
                 "threadId" : threadId
                })
        logging.debug('GetContent on %s emails took %0.3f ms' % (len(emailIds), (time.time()-t1)*1000.0))
        return res #reverse them, so they are date sorted
    except imaplib.IMAP4.abort as e:
        logging.error(e)
        app.mail = imaplib.IMAP4_SSL('imap.gmail.com')
        app.mail.login(os.environ.get('ARCHIVEEMAIL') or 'empty', os.environ.get('ARCHIVEPASSWORD') or 'secret')
        app.mail.select(Mailboxes.HELPME)
        return getEmailBatch(uids)

def getBody(msg, htmlIfEmpty=True, magick=False):
    '''
    Returns the body of an email.message as plain unicode, extracting only the text MIME type.
    If htmlIfEmpty is specified, if there is not plain/text content, multipart content is
    extracted, in cases such as inline html images in weird mail clients.
    magick is a simple param to ensure that we do not infinitely recurse in situations where 
    multipart/mixed and text/plain produce zero length bodies.
    '''
    res = ''
    for part in msg.walk():
        if part.get_content_type() == "text/plain" or (htmlIfEmpty and part.get_content_type() == "multipart/mixed"): #we don't want the HTML, or attachments
            if part.get_content_charset() is None:
                charset = chardet.detect(str(part))['encoding']
            else:
                charset = part.get_content_charset()
            try:
                res += unicode(part.get_payload(decode=True) or '',str(charset),"ignore")
            except Exception as e:
                logging.error("Decoding error: %s original={%s}"%(e, part.get_payload(decode=True)))
                continue
    res = re.sub("^(\s*\r\n){2,}",'\r\n',res) #remove double line breaks
    if htmlIfEmpty and len(res) ==0 and not magick:
        return getBody(msg,True,True)
    return res.replace("-------------- next part --------------\r\nSkipped content of type text/html","") #not sure why mailman inserts this everywhere


@cache.memoize() #memoize this operation to allow pagination later
def searchMail(query):
    try:
        query = query.translate(None,"\"'") #quote characters are the only literal which will break search
        typ, data = app.mail.search('utf8', '(X-GM-RAW "%s")'% query)
        return [r for r in reversed(data[0].split())] #Google gives them in reverse date order...
    except (imaplib.IMAP4.abort, Exception) as e:
        logging.error(e)
        app.mail = imaplib.IMAP4_SSL('imap.gmail.com')
        app.mail.login(os.environ.get('ARCHIVEEMAIL') or 'empty', os.environ.get('ARCHIVEPASSWORD') or 'secret')
        app.mail.select(Mailboxes.HELPME)
        return searchMail(query)
    */

function searchMail (list, keywords, next) {
  imap.openBox(list, true, function (err) {
    if (err) {
      console.error('Error connecting', err);
      process.exit(1);
    }

    imap.search([
      ['TEXT', keywords.join(' ')]
    ], function (err, results) {
      if (err) {
        next(null, []);
      } else {
        next(null, results);
      }
    });
  });
}

function retrieveMail (results, next) {
  var messages = [], count = 0, done = false;
  imap.fetch(results, { struct: false },
    { headers: { parse: false },
      body: true,
      cb: function (fetch) {
        fetch.on('message', function (msg) {
          console.log('Checking message no. ' + msg.seqno);
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

            messages.push({
              seqno: msg.seqno,
              uid: msg.uid,
              subject: obj.subject,
              from: obj.from,
              to: obj.to,
              html: obj.html,
              text: text,
              date: new Date(obj.headers.date)
            });

            count--;
            if (count <= 0 && done) {
              console.log('Done fetching all messages!');
              next(null, messages);
            }
          });

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
        next(err, []);
      };
      if (count == 0) {
        console.log('Done fetching some messages...');
        next(null, messages);
      }
    }
  );
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

app.get('/', function (req, res) {
  res.render('index', {
    title: 'Olin Lists',
    user: olinapps.user(req),
    sessionid: req.session.sessionid
  });
});

app.get('/api/lists/:list', function (req, res) {
  searchMail(req.params.list, (req.query.text || '').split(/\s+/), function (err, ids) {
    var chunkSize = 20;
    var groups = [].concat.apply([],
      ids.map(function (elem, i) {
        return i % chunkSize ? [] : [ids.slice(i, i + chunkSize)];
      })
    ).map(function (arr) {
      return 'http://' + app.get('host') + '/api/messages?ids=' + arr.join(',') + '&sessionid=' + req.session.sessionid
    });
    res.json({ids: groups});
  })
})

app.get('/api/messages', function (req, res) {
  var ids = req.query.ids ? req.query.ids.split(',') : [];
  retrieveMail(ids, function (err, messages) {
    if (err) {
      messages = [];
    }
    res.json({messages: messages});
  })
})

/**
 * Launch
 */

openInbox(function () {
  http.createServer(app).listen(app.get('port'), function(){
    console.log("Express server listening on http://" + app.get('host'));
  });
});