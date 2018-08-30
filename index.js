// Load dependencies
var express = require('express');
var exphbs  = require('express-handlebars');
var bodyParser = require('body-parser');
var mongo = require('mongo-mock')
var request = require('request');
var MongoClient = mongo.MongoClient;
var questions = require('./questions.json');

// Load configuration from .env file
require('dotenv').config();

// This is the MongoDB URL. It does not actually exist
// but our mock requires a URL that looks "real".
var dbUrl = "mongodb://localhost:27017/myproject";

// Set up and configure the Express framework
var app = express();
app.engine('handlebars', exphbs());
app.set('view engine', 'handlebars');
app.use(bodyParser.json({
    type : function(req) {
        // Parse all bodies as JSON even without Content-Type
        return true;
    }
}));
// Trust proxies like ngrok so that we can know the URL to the application
app.enable('trust proxy');

/**
 * Helper function to generate a "say" call flow step.
 */
function say(payload) {
    return {
        action : 'say',
        options : {
            payload : payload,
            voice : 'male',
            language: 'en-US'
        }
    };
}

app.all('/callStep', function(req, res) {
    // Prepare a Call Flow that can be extended
    var flow = {
        title : "Survey Call Step",
        steps : []
    };

    MongoClient.connect(dbUrl, {}, function(err, db) {        
        var surveyParticipants = db.collection('surveyParticipants');
        
        // Find a database entry for the number
        surveyParticipants.findOne({ callId : req.query.callID },
            function(err, doc) {
                // Determine the next question
                var questionId =
                    (doc == null) ? 0 // The person is just starting the survey
                    : doc.responses.length + 1;
                
                if (doc == null) {
                    // Create new participant database entry
                    var doc = {
                        callId : req.query.callID,
                        number : req.query.destination,
                        responses : []
                    };
                    surveyParticipants.insertOne(doc, function(err, result) {
                        console.log("created survey participant", err, result);
                    });
                }

                if (questionId > 0) {
                    // Unless we're at the first question, store the response
                    // of the previous question
                    doc.responses.push({
                        legId : req.body.legId,
                        recordingId : req.body.id
                    });
                    surveyParticipants.updateOne({ number : req.query.destination }, {
                        $set: {
                            responses : doc.responses
                        }
                    }, function(err, result) {
                        console.log("updated survey participant", err, result);
                    });
                }

                if (questionId == questions.length) {
                    // All questions have been answered
                    flow.steps.push(say("You have completed our survey. Thank you for participating!"));
                } else {
                    if (questionId == 0) {
                        // Before first question, say welcome
                        flow.steps.push(say("Welcome to our survey! You will be asked " + questions.length + " questions. The answers will be recorded. Speak your response for each and press any key on your phone to move on to the next question. Here is the first question:"));
                    }
                    // Ask next question
                    flow.steps.push(say(questions[questionId]));

                    // Request recording of question
                    flow.steps.push({
                        action : 'record',
                        options : {
                            // Finish either on key press or after 10 seconds of silence
                            finishOnKey : 'any',
                            timeout : 10,
                            // Send recording to this same call flow URL
                            onFinish : req.protocol + "://" + req.hostname + '/callStep',
                        }
                    })
                }

                // Return flow as JSON response
                res.json(flow);
            });
    });
});

app.get('/admin', function(req, res) {
    MongoClient.connect(dbUrl, {}, function(err, db) {        
        var data = {};
        var surveyParticipants = db.collection('surveyParticipants');
        surveyParticipants.find().toArray(function(err, docs) {
            res.render('participants', {
                questions : questions,
                participants : docs
            });
        });
    });
});

app.get('/play/:callId/:legId/:recordingId', function(req, res) {
    // Make a proxy request to the audio file on the API
    request({
        url : 'https://voice.messagebird.com/calls/' + req.params.callId + '/legs/' + req.params.legId
            + '/recordings/' + req.params.recordingId + '.wav',
        headers : {
            'Authorization' : 'AccessKey ' + process.env.MESSAGEBIRD_API_KEY
        }
    }).pipe(res);
});

app.listen(8080);