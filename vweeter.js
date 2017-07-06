var firebase      = require('firebase');
var defaultDatabase, channelRef, broadcastRef;
var channels = [];
var voices = {};

var isBroadcastingStarted = {};
var broadcasts = [];
var numberOfCycle = 20;
var numberOfCache = 3;

var AWS                = require('aws-sdk');
var vweeterapp_bucket  = 'vweeterappnortheast2/voices';

var voicesQueue = {};
var nextQueueItem = {};
var tempQueueItem = {};
var timer = {};

/**
 * development mode on/off
 */
const isDevMode = false;

/**
 * initialize
 */
Vweeter = () => {

    var http = require('https');
    setInterval(function(){
        isDevMode == true ? http.get('https://vweeterdev.herokuapp.com/') : http.get('https://vweeter.herokuapp.com/');
    },300000);

    AWS.config.update({
        accessKeyId: process.env.S3_KEY,
        secretAccessKey: process.env.S3_SECRET,
        region: 'ap-northeast-2'
    });

    AWS.config.apiVersions = {
        s3: '2012-10-17'
    };

    defaultDatabase = firebase.database();
    channelRef = isDevMode == true ? firebase.database().ref('dev_Channels') : firebase.database().ref('Channels');
    broadcastRef = isDevMode == true ? firebase.database().ref('dev_Broadcast') : firebase.database().ref('Broadcast');

    trackChannels();

    trackBroadCasts();
    
    trackDisconnectedUsers();

}

/**
 * implementation for users closed app playing in background.
 */
trackDisconnectedUsers = () => {
    firebase.database().ref('disconnectedUsers').on('child_added', function(snapshot){
        if(snapshot.val() != null){
            var userId = snapshot.key;
            var channelId = snapshot.val();

            // remove user from channelRef
            channelRef.child(channelId).child('listeners').child(userId).remove();
            firebase.database().ref('disconnectedUsers').child(userId).remove();
        }
    });
}

/**
 * get new added broadcasts in Firebase.
 */
trackBroadCasts = () => {
    broadcastRef.on('child_added', function(snapshot){
        if(snapshot.val() != null){
            console.log( snapshot.key + ' intialized as ' + snapshot.val().live.idx);
        }
    });
}

/**
 * get new added channels in Firebase.
 */
trackChannels = () => {
    channelRef.on('child_added', function(snapshot) {
        var name = snapshot.key;
        channels.push(name);
        trackVoices(name);
    });

    channelRef.on('child_removed', function(snapshot) {
        var name = snapshot.key;
        //TODO:
    });
}

/**
 * @param (channel:String) : current channel name.
 * load old voices as many as limited number of cycle.
 * get incoming voices which is fresh uploaded.
 * get removed voices which is played among looping voices.
 */
trackVoices = (channel) => {
    var voiceRef = isDevMode == true ? firebase.database().ref('dev_Voices/' + channel) : firebase.database().ref('Voices/' + channel);
    var initQuery = voiceRef.limitToLast(numberOfCycle);

    voices[channel] = [];    
    isBroadcastingStarted[channel] = false;

    // when server is restarting...
    initQuery.once('value', function(snapshot){
        if (snapshot.val() != null){
            snapshot.forEach(function(obj){
                var key = obj.key;
                var duration = obj.val().duration;
                var fileName = obj.val().fileName;
                var filePath = obj.val().filePath;
                var isPlayed = obj.val().isPlayed;
                if (isPlayed){
                    var voice = {
                        'key': key,
                        'fileName':fileName,
                        'filePath':filePath,
                        'duration':duration,
                        'isPlayed':isPlayed
                    };
                    voices[channel].push(voice);
                    console.log('initQuery: ' + voice.key);
                }
            });

            startBroadcastChannel(channel);
        }
        
    });

    // track incoming new voices
    var queryRef = voiceRef.orderByChild('isPlayed').equalTo(false);
    queryRef.on('child_added', function(snapshot){
        if (snapshot.val() != null) {
            var key = snapshot.key;
            var duration = snapshot.val().duration;
            var fileName = snapshot.val().fileName;
            var filePath = snapshot.val().filePath;
            var isPlayed = snapshot.val().isPlayed;
            var voice = {
                    'key': key,
                    'fileName':fileName,
                    'filePath':filePath,
                    'duration':duration,
                    'isPlayed':isPlayed
                };
            voices[channel].push(voice);
            console.log(channel + ' : child_added: ' + key);

            if (voices[channel].length < 2){
                console.log('setBraodcast: ' + channel + ', ' + null + ' due to less than 2.');
                setBroadcastValue(channel, null);
            }else{
                if (!isBroadcastingStarted[channel]) {
                    var first_voice = voices[channel][0];
                    setBroadcastValue(channel, first_voice);
                }else{
                    var count = numberOfnewVoices();
                    if (count > 1) //----> in case of new voices exist more than 1.
                    {
                        console.log(channel + ": new voice count -> " + count);
                    }else{
                        tempQueueItem[channel] = nextQueueItem[channel];
                        nextQueueItem[channel] = voice;
                    }
                }
            }
        }
    });

    // track removed voices
    queryRef.on('child_removed', function(snapshot){
        if(snapshot.val() != null){
            if (voices[channel].length > numberOfCycle){
                var numberOfnew = 0, numberOfold = 0; 
                voices[channel].forEach(function(element){
                    if (element.isPlayed){
                        numberOfold += 1;
                    }else{
                        numberOfnew += 1;
                    }
                });

                if (numberOfnew >= numberOfCycle){
                    // remove all old voices
                    for (var i = 0; i < voices[channel].length; i++){
                        var element = voices[channel][i];
                        if (element.isPlayed){
                            if (element.key != nextQueueItem[channel].key){
                                voices[channel].splice(i, 1);
                                deleteOldvoice(channel, element);
                            }
                        }
                    }
            
                }else{
                    for (var i = 0; i < voices[channel].length; i++){
                        var element = voices[channel][i];
                        if (element.isPlayed){
                            voices[channel].splice(i, 1);
                            deleteOldvoice(channel, element);
                            break;
                        }
                    }
                }
            }

        }
    });

    voiceRef.on('child_removed', function(snapshot){
        //TODO: implementation after removed
    });


    // track banned users
    channelRef.child(channel).child('bannedUsers').on('child_added', function(snapshot){
        if (snapshot.val() != null){
            var bannedUserId = snapshot.key;
            console.log('banned user: ' + bannedUserId);
            //TODO: remove voices of banned users

        }
    });
}

/**
 * @param (channel:String): current channel name
 * register broadcast and get event when its value updated.
 */
startBroadcastChannel = (channel) => {

    broadcastQuery = broadcastRef.child(channel);
    broadcastQuery.on('value', function(snapshot){
        if (snapshot.val() != null){
            var channel = snapshot.key;
            var currentID = snapshot.val().live.idx;
            var currentDuration = snapshot.val().live.duration;
            updatedBroadcast(channel, currentID, currentDuration);
        }
    });
}

/**
 * @param (channel:String): current channel name.
 * @param (currentID:String): current playing voice identify.
 * @param (currentDuration:Double): current playing voice length(seconds).
 * update broadcast current playing voice's identify from old one.
 */
updatedBroadcast = (channel, currentID, currentDuration) => {
    console.log(channel + ' updatedBroadcast: ' + currentID);
    determineNextQueueItem(channel, currentID, function(nextItem){
        playNext(channel, (currentDuration+2.0)*1000);
    });
}

/**
 * @param (channel:String): current channel name.
 * @param (currentID:String): current playing voice identify.
 * @param (callback:(Object): get next voice in playing Queue.
 * @return next voice in playing queue.
 */
determineNextQueueItem = (channel, currentID, callback) => {

    var newVoicesCount = numberOfnewVoices();
    if (newVoicesCount > 1)
    {
        checkNewvoice(channel, function(isExistNew, voice){
            var nextItem = null;
            if(isExistNew){
                checkExistvoice(channel, currentID, function(isExist, indexOf){
                    if (isExist){
                        nextItem = voice;
                        nextQueueItem[channel] = nextItem; 
                    }
                });
            }else{
                checkExistvoice(channel, currentID, function(isExist, indexOf){
                    if (isExist){
                        var livevoice = voices[channel][indexOf];
                        if (tempQueueItem[channel]) {
                            nextItem = tempQueueItem[channel];
                            tempQueueItem[channel] = null;
                        } else {
                            var j = indexOf + 1;
                            if (j >= voices[channel].length) j=0;
                            nextItem = voices[channel][j];
                        }

                        nextQueueItem[channel] = nextItem;
                    } else {
                        if (voices[channel].length > 0){
                            nextItem = voices[channel][0];
                        }
                        nextQueueItem[channel] = nextItem;
                    }
                });
            }

            callback(nextItem);
        });
    } 
    else 
    {
        var nextItem = null;
        checkExistvoice(channel, currentID, function(isExist, indexOf){
            if (isExist){
                var livevoice = voices[channel][indexOf];
                if (tempQueueItem[channel]) {
                    nextItem = tempQueueItem[channel];
                    tempQueueItem[channel] = null;
                } else {
                    var j = indexOf + 1;
                    if (j >= voices[channel].length) j=0;
                    nextItem = voices[channel][j];
                }

                nextQueueItem[channel] = nextItem;
            } else {
                if (voices[channel].length > 0){
                    nextItem = voices[channel][0];
                }

                nextQueueItem[channel] = nextItem;
            }
        });

        callback(nextItem);
    }
}

/**
 * @param (channel:String): current channel name.
 * @param (checkID:String): current playing queue item identify.
 * @return callback(Boolean, Integer)
 * Boolean value for existing voice in playing Queue.
 * Integer value for order of the existing voice. 
 */
checkExistvoice = (channel, checkID, callback) => {

    var isExist = false;
    var indexOf = 0;
    var j = 0;
    for (var i = 0; i < voices[channel].length; i++){
        var voice = voices[channel][i];
        var key = voice.key;
        if (key == checkID){
            j = i + 1;
            if (j >= voices[channel].length) j = 0;
            indexOf = i;
            isExist = true;
            break;
        }
    }

    callback(isExist, indexOf);
}

/**
 * @param (channel:String): current channel name.
 * @param (callback:function): receive following params.
 * @return callback(Boolean, Object)
 * Boolean value for existing new voice in playing Queue.
 * Object value is voice for the existng new voice.
 */
checkNewvoice = (channel, callback) => {
    var isExist = false;
    var voice = null;
    for (var idx = 0; idx < voices[channel].length; idx++){
        voice = voices[channel][idx];
        var isPlayed = voice.isPlayed;
        if (isPlayed == false) {
            isExist = true;
            break;
        }
    }

    return callback(isExist, voice);
}

/**
 * @return count new incoming voices in a channel
 */
numberOfnewVoices = (channel) => {
    var count = 0;
    var arrVoice = voices[channel];
    if(arrVoice != null){
        if(arrVoice.length > 0){
            voices[channel].forEach(function(element) {
                if (element.isPlayed == false){
                    count += 1;
                }
            });
        }
    }
    return count;
}

/**
 * @param (channel:String): current channel name.
 * stop playing voices.
 */
stopPlay = (channel) => {
    clearTimeout(timer[channel]);
}

playNext = (channel, delay) => {
    isBroadcastingStarted[channel] = true;
    timer[channel] = setTimeout(function(){
        isBroadcastingStarted[channel] = false;
        setBroadcastValue(channel, nextQueueItem[channel]);
    }, delay);
}

/**
 * @param (channel:String): current channel name.
 * @param (voice:Object): voice to be played.
 * update broadcast live voice identify.
 * update voice's status from new to old.
 */
setBroadcastValue = (channel, voice) => {
    if (voice != null){
        var voiceID = voice.key;
        var duration = voice.duration;
        var isPlayed = voice.isPlayed;
        broadcastRef.child(channel).set({
            'live' : {
                'idx':voiceID,
                'isNew':!isPlayed,
                'duration': duration
            },
        });

        if (voice.isPlayed == false){
            voice.isPlayed = true;
            var voiceRef = isDevMode == true ? firebase.database().ref('dev_Voices/' + channel) : firebase.database().ref('Voices/' + channel);
            voiceRef.child(voice.key).update({
                'isPlayed': voice.isPlayed
            });
        }
    } else {
        broadcastRef.child(channel).set({
            'live' : {
                'idx':999,
                'isNew':false,
                'duration': 1.0
            },
        });
    }
}

/**
 * @param (name:String): channel name to be created.
 * @param (profile:String): channel profile image link.
 * create new channel.
 */
createNewChannel = (name, link) => {
    channelRef.child(name).set({
        'url_flag':link
    });
}

/**
 * @param (channel:String): current channel name.
 * @param (voice:Object): voice to be deleted.
 * delete voice's info from Firebase
 * delete voice's file from AWS S3. 
 */
deleteOldvoice = (channel, voice) => {
    var voiceRef = isDevMode == true ? firebase.database().ref('dev_Voices/' + channel) : firebase.database().ref('Voices/' + channel);     
    var key = voice.key;
    var file = voice.fileName;
    voiceRef.child(key).remove();
    deleteS3Object(file);

    console.log(channel + ': child_removed: ' + key);
}

/**
 * @param(key:String): file name to be deleted on S3.
 * delete a file from AWS S3 with access key.
 */
deleteS3Object = (key) => {
    var s3 = new AWS.S3({
        params:{
            Bucket: vweeterapp_bucket,
        }
    });

    var params = {
        Bucket: vweeterapp_bucket,
        Key: key
    };

    s3.deleteObject(params, function(err, data){
        if (err){
            console.log(err);
        }else{
            console.log('delete file : ' + key + 'done.');
        }
    });
}

/**
 * @param (key: String): file name to be saved on S3.
 * @param (file: String): putting file
 * put a file to S3.
 */
putS3Object = (key, file) => {
    var bucket = new AWS.S3({
        params:{
            Bucket: vweeterapp_bucket
        }
    });

    var params = {
        Key: key,
        ContentType: file.type,
        Body:file,
        ACL: 'public-read'
    };

    bucket.putObject(params, function(error, data){
        if (error) {
            console.log("Error:" + error);
        } else {
            console.log("File has been put on S3.")
        }
    });
}

/**
 * @param (key:String): file name to be saved on S3.
 * @param (file:String): uploading file path.
 * upload file to S3.
 */
uploadFileToS3 = (key, file) => {
    var s3 = require('s3');
    var awsS3Client = new AWS.S3({
        params:{
            Bucket: vweeterapp_bucket,
        }
    });

    var options = {
        s3Client: awsS3Client,
    };

    var client = s3.createClient(options);

    var params = {
        localFile: "some/local/file",

        s3Params: {
            Bucket: vweeterapp_bucket,
            Key: key,
        },
    };

    var uploader = client.uploadFile(params);
    uploader.on('error', function(error){
        console.error("unable to upload:", error.stack);
    });
    uploader.on('progress', function(){
        console.log("progress", uploader.progressMd5Amount, uploader.progressAmount, uploader.progressTotal);
    });
    uploader.on('end', function(){
        console.log("done uploading");
    });
}

module.exports = Vweeter;