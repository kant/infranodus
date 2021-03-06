// Import library to generate UID for statements
var uuid = require('node-uuid');

// Import string processing libraries
var S = require('string');
var jsesc = require('jsesc');

// Import Hashtag extraction library
var FlowdockText = require('flowdock-text');

// Options for Stack Overflow
var options = require('../../options');




function parseField(field) {
    return field
        .split(/\[|\]/)
        .filter(function(s){ return s });
}


function getField(req, field) {
    var val = req.body;
    field.forEach(function(prop){
        val = val[prop];
    });
    return val;
}

// TODO Move the two functions below to tools/instruments.js

// Function to extract hashtags from any input

function extractHashtags(statement) {

    var hashtags = FlowdockText.extractHashtags(statement);

    // Convert them to lowercase
     for (var i = 0; i < hashtags.length; i++) {
        if (!S(hashtags[i]).isUpper()) {
            hashtags[i] = S(hashtags[i]).dasherize().chompLeft('-').camelize().s;
        }
        else {
            hashtags[i] = hashtags[i].toLowerCase();
        }
    }
    return hashtags;
}


// Function to extract context from any input

function extractContexts(statement) {

    var contexts = FlowdockText.extractMentions(statement);

    // Convert them to lowercase
    for (var i = 0; i < contexts.length; i++) {
        if (!S(contexts[i]).isUpper()) {
            contexts[i] = S(contexts[i]).dasherize().chompLeft('-').camelize().s;
        }
        else {
            contexts[i] = contexts[i].toLowerCase();
        }
    }
    return contexts;
}


exports.isLoggedIn = function(){
    return function(req, res, next){
        if (! res.locals.user) {
            res.error('Please, log in or register first.');
            res.redirect('back');
        } else {
            next();
        }
    }
};


exports.stackOverflow = function(field){
    field = parseField(field);
    return function(req, res, next){
        var len = options.settings.max_text_length;
        if (getField(req, field).length > len) {

            res.error('try to make it less than ' + len + ' characters, please...');
            res.redirect('back');

        } else {
            next();
        }
    }
};



exports.isToDelete = function(){
    return function(req, res, next){

        // Construct delete query

        var delete_query = [];

        if (req.body.entry.hashtags.length != 1) {

            // A query for when there's more than 1 hashtag/concept

            delete_query[0] = 'START rel=relationship:relationship_auto_index(statement="' + req.body.statementid + '")' +
                              'DELETE rel;';

            delete_query[1] = 'MATCH (s:Statement{uid:"' + req.body.statementid + '"}), ' +
                              's-[by:BY]->u, s-[in:IN]->ctx, c-[of:OF]->s ' +
                              'DELETE by,in,of,s;'

        }
        else {

            // A query for when there's only 1 hashtag
            delete_query[0] = 'MATCH (s:Statement{uid:"' + req.body.statementid + '"}), ' +
                's-[rel]-a WITH rel, s ' +
                'MATCH c1-[:OF]->s, c1-[by:BY]->u, c1-[at:AT]->ctx ' +
                'WHERE ' +
                'by.statement="' + req.body.statementid + '" AND ' +
                'at.statement="' + req.body.statementid + '" ' +
                'DELETE s,rel,by,at;';

            delete_query[1] = 'MATCH (s:Statement{uid:"' + req.body.statementid + '"}) RETURN s;';
        }


        // Now let's check if the user wants to delete or edit a node

        if (req.body.delete == 'delete') {

            if (req.body.statementid) {

                console.log(delete_query);

                deleteStatement(goBack);

            }
            else {

                res.error('Sorry, but we did not get the ID of what you wanted to delete.');
                res.redirect('back');

            }

        }
        else if (req.body.submit == 'edit') {

            if (req.body.statementid) {

                console.log(delete_query);
                deleteStatement(moveOn);

            }
            else {

                res.error('Sorry, but we did not get the ID of what you wanted to edit.');
                res.redirect('back');

            }


        }
        else {
            // Neither delete, nor edit, let's just pass it on and hope for the best! (adding a new one, that is)
            next();
        }


        function deleteStatement (callback) {

            dbneo.beginAndCommitTransaction({
                statements : [ {
                                    statement : delete_query[0],
                                    resultDataContents : [ 'row', 'graph' ]
                               },
                                {
                                    statement : delete_query[1],
                                    resultDataContents : [ 'row', 'graph' ]
                                }
                ]
            }, function(err, cypherAnswer){

                    if(err) {
                        err.type = 'neo4j';
                        return callback(err);
                    }
                    // No error? Pass the contexts to makeQuery function
                    callback(null,cypherAnswer);


            });



        }

        // That's in case we want to go back (when deleted, for example)

        function goBack (err,answer) {

            // Error? Display it.
            if (err) {
                console.log(err);
                res.error('Sorry, mate, something went wrong on the Deleting part...');
                res.redirect('back');
            }
            else {

                // If all is good, make a message for the user and send him back
                res.error('Deleted. As if it has never been there.');
                res.redirect('back');
            }

        }

        // That's when we want to move on (when deleted and adding a new one

        function moveOn (err,answer) {

            // Error? Display it.
            if (err) {
                console.log(err);
                res.error('Sorry, mate, something went wrong on the Editing part...');
                res.redirect('back');
            }
            else {
                // If all is good, movemove on
                next();
            }

        }

    }
};

exports.required = function(field){
    field = parseField(field);
    return function(req, res, next){
        if (getField(req, field)) {
            next();
        } else {
            res.error(field.join(' ') + ' is required');
            res.redirect('back');
        }
    }
};

exports.lengthAbove = function(field, len){
    field = parseField(field);
    return function(req, res, next){
        if (getField(req, field).length > len) {
            next();
        } else {
            res.error(field.join(' ') + ' must have more than ' + len + ' characters');
            res.redirect('back');
        }
    }
};


// Functions to sanitize input and to process hashtags TODO: make it field (entry.body) independent

exports.sanitize = function(field){

    field = parseField(field);

    return function(req, res, next){
        result = getField(req, field);
        result = S(result).trim().collapseWhitespace().s;
        result = jsesc(result, {
            'quotes': 'double'
        });

        req.body.entry.body = result;

        console.log("Text body normalized: " + req.body.entry.body);

        next();
    }
};


exports.getHashtags = function(field) {
    field = parseField(field);
    return function(req,res,next) {

        val = getField(req, field);

        var hashtags = extractHashtags(val);

        var maxhash = options.settings.max_hashtags;

        if (hashtags[0] != null && hashtags.length < maxhash) {
            req.body.entry.hashtags = hashtags;
            console.log("Hashtags extracted: " + req.body.entry.hashtags);
            next();
        }
        else if (hashtags.length >= maxhash) {
            res.error('please, try to use less than ' + maxhash + ' #hashtags');
            res.redirect('back');
        }
        else {
            res.error('there should be at least one #hashtag. you can double-click the words to hashtag them.');
            res.redirect('back');
        }
    }
}

exports.getContext = function(field) {
    field = parseField(field);
    return function(req,res,next) {

        val = getField(req, field);

        // Contexts extracted from the statement entry form (@mentions)
        var contexts = extractContexts(val);

        // The context user was at when he opened the page
        var default_context = req.body.context;

        // The filtering contexts that were selected
        var selectedContexts = req.body.selectedContexts.split(',');

        // Some contexts extracted from the body?
        if (contexts[0] != null) {

            // TODO remove 'private' from here to address issue #29
            // Push the main context of the page into the contexts list
            if (default_context != 'undefined' && typeof default_context != 'undefined' && default_context != '') {
                if (contexts.indexOf('@' + default_context) == -1) {
                    contexts.push('@' + default_context);
                    req.body.entry.body += ' @' + default_context;
                }
            }

            // Push selected contexts of the page into the contexts list
            if (selectedContexts[0].length > 0) {
                for (var r=0;r<selectedContexts.length;++r) {
                    if (contexts.indexOf('@' + selectedContexts[r]) == -1) {
                        contexts.push('@' + selectedContexts[r]);
                        req.body.entry.body += ' @' + selectedContexts[r];
                    }
                }
            }

            // Remove the @mention sign
            // TODO Do something about the unnecessary @mention sign mess (compare here and below)
            for (var i=0;i<contexts.length; ++ i) {
                contexts[i] = contexts[i].substr(1);
            }

            // Make new clean contexts parameter to pass on
            req.body.entry.contexts = contexts;

            // Make sure we got it right
            console.log("Contexts extracted: " + req.body.entry.contexts);

            // Pass it on
            next();

        }
        // No contexts in the body? Use the default one!
        else {
            var contexts = [];

            // No default context?
            if (default_context == 'undefined' || typeof default_context === 'undefined' || default_context == '') {



                // TODO this function below is a duplicate of the above, take it out into a separate one
                if (selectedContexts[0].length > 0) {
                    for (var r=0;r<selectedContexts.length;++r) {
                        if (contexts.indexOf(selectedContexts[r]) == -1) {
                            contexts.push(selectedContexts[r]);
                            req.body.entry.body += ' @' + selectedContexts[r];
                        }
                    }
                }
                else {
                    // TODO take out "private" into settings

                    contexts.push('private');
                    req.body.entry.body += ' @' + contexts[0];


                }

            }

            // There is a default context, so let's add that one and other ones that are selected
            else {
                contexts[0] = default_context;
                req.body.entry.body += ' @' + contexts[0];
                if (selectedContexts[0].length > 0) {
                    for (var r=0;r<selectedContexts.length;++r) {
                        if (contexts.indexOf(selectedContexts[r]) == -1) {
                            contexts.push(selectedContexts[r]);
                            req.body.entry.body += ' @' + selectedContexts[r];
                        }
                    }
                }
            }

            // Make a new clean context parameter
            req.body.entry.contexts = contexts;
            console.log("Context @" + contexts[0] + " added automatically: " + req.body.entry.contexts);

            // Pass it on
            next();

        }
    }
}


// How to know user's ID from their name
// TODO This function should probably go somewhere else, not so cool to have Cypher query in here also

exports.getUserID = function(){

    return function(req, res, next){

        // Do we have user ID we want to view in our URL?

        if (req.params.user) {

            // We do? Then get the ID and pass it on further along the line...

            var query = 'MATCH (u:User{name:"' + req.params.user + '"}) RETURN u.uid';

            obtainUserID(passOn);

        }

        // There's no ID of the user in the URL to look, ok...
        else {


            // Is the one who's trying to view logged in?
            if (! res.locals.user) {

                // Not logged in? Well, then let's pass the user further along the line
                res.locals.viewuser = '';
                next();


            } else {

                // Aha, he's logged in and he doesn't say which users he wants, so we show him himself

                res.locals.viewuser = res.locals.user.uid;
                next();

            }
        }


        // Here we get the ID of the user

        function obtainUserID (callback) {
            dbneo.cypherQuery(query, function(err, cypherAnswer){

                if(err) {
                    err.type = 'neo4j';
                    return callback(err);
                }
                // No error? Pass the contexts to makeQuery function
                callback(null,cypherAnswer);


            });
        }

        // Here we pass it on to res. variable

        function passOn (err,answer) {

            // Error? Display it.
            if (err) console.log(err);

            // So we take the answer, which is the ID of the user we want to view, and give it to res variable
            res.locals.viewuser = answer.data[0];

            next();

        }



    }
};





