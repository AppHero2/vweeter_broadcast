var firebase      = require('firebase');
var defaultDatabase, channelRef, broadcastRef;
var channels = [];
var vweeters = {};
var isInitializedVweeters = {};
var isInitializedCleaners = {};
var isBroadcastingStarted = {};
var broadcasts = [];
var numberOfCycle = 5;
var numberOfCache = 3;

var AWS                    = require('aws-sdk');
var vweeterapp_bucket  = 'vweeterappnortheast2/voices';

var nextQueue = {};
var tempQueue = {};
var timer = {};

Vweeter = () => {

    console.log('S3_KEY: ' ,process.env.S3_KEY);

    AWS.config.update({
        accessKeyId: process.env.S3_KEY,
        secretAccessKey: process.env.S3_SECRET,
        region: 'ap-northeast-2'
    });

    AWS.config.apiVersions = {
        s3: '2012-10-17'
    };

    defaultDatabase = firebase.database();
    channelRef = firebase.database().ref('Channel');
    broadcastRef = firebase.database().ref('Broadcast');

    trackChannels();

    trackBroadCasts();
}

Vweeter.update = () => {
    console.log('-- update --');
}

trackBroadCasts = () => {
    broadcastRef.on('child_added', function(snapshot){
        if(snapshot.val() != null){
            console.log( snapshot.key + ' intialized as ' + snapshot.val().live.idx);
        }
    });
}

trackChannels = () => {
    channelRef.on('child_added', function(snapshot) {
        var name = snapshot.key;
        channels.push(name);
        trackVweeters(name);
    });
}

trackVweeters = (channel) => {
    var vweeterRef = firebase.database().ref('Vweeter/' + channel);
    var queryRef = vweeterRef.limitToLast(numberOfCycle);
    vweeters[channel] = [];
    isInitializedVweeters[channel] = false;
    isBroadcastingStarted[channel] = false;

    queryRef.on('child_added', function(snapshot) {
        var key = snapshot.key;

        var duration = snapshot.val().duration;
        var fileName = snapshot.val().fileName;
        var filePath = snapshot.val().filePath;
        var isPlayed = snapshot.val().isPlayed;
        var vweeter = {
                'key': key,
                'fileName':fileName,
                'filePath':filePath,
                'duration':duration,
                'isPlayed':isPlayed
            };
        vweeters[channel].push(vweeter);

        var isInitialized = isInitializedVweeters[channel];
        if (isInitialized){
            if (vweeters[channel].length < 2){
                console.log('setBraodcast: ' + channel + ', ' + null);
                setBroadcastValue(channel, null);
            }else{
                if (!isBroadcastingStarted[channel]) {
                    setBroadcastValue(channel, vweeter);
                }else{
                    tempQueue[channel] = nextQueue[channel];
                    nextQueue[channel] = vweeter;
                }

            }
        }
    });

    queryRef.on('child_removed', function(snapshot){
        if(snapshot.val() != null){
            checkExistVweeter(channel, snapshot.key, function(isExist, indexOf){
                if (isExist) {
                    vweeters[channel].splice(indexOf, 1);
                    console.log(channel + ': child_removed: ' + snapshot.key);
                    
                    if (vweeters[channel].length > 0) {
                        if (nextQueue[channel].key == snapshot.key) {
                            if (indexOf >= vweeters[channel].length) {
                                nextQueue[channel] = vweeters[channel][0];
                            } else {
                                nextQueue[channel] = vweeters[channel][indexOf];
                            }
                        }
                        if (!isBroadcastingStarted[channel]) {
                            if (nextQueue[channel] != null){
                                setBroadcastValue(channel, nextQueue[channel]);
                            }
                        }
                    }
                }
            });
        }
    });

    queryRef.once('value', function(snapshot){
        isInitializedVweeters[channel] = true;
        startBroadcastChannel(channel);
    });

    cleanOldvweeter(channel);
}

startBroadcastChannel = (channel) => {
    // need to create broadcast if we dont have yet
    checkoutBroadcast(channel);

    broadcastQuery.on('value', function(snapshot){
        if (snapshot.val() != null){
            var channel = snapshot.key;
            var currentID = snapshot.val().live.idx;
            
            updatedBroadcast(channel, currentID);
        }
    });
}

updatedBroadcast = (channel, currentID) => {

    checkExistVweeter(channel, currentID, function(isExist, indexOf){
        var duration = 0.0;
        if (isExist){
            var vweeter = vweeters[channel][indexOf];
            duration = vweeter.duration;
        }
        console.log(channel + ' : isExist-> '+ isExist + ', indexOf-> ' + indexOf + ', next-> ' + ((nextQueue[channel]==null)?'null':nextQueue[channel].key));
        var delay = (duration + 2.0) * 1000;

        if (tempQueue[channel]) {
            nextQueue[channel] = tempQueue[channel];
            tempQueue[channel] = null;
        } else {
            var j = indexOf + 1;
            if (j >= vweeters[channel].length) j=0;
            nextQueue[channel] = vweeters[channel][j];
        }

        playNext(channel, delay);
    });
}

checkExistVweeter = (channel, checkID, callback) => {

    var isExist = false;
    var indexOf = 0;
    var j = 0;
    for (var i = 0; i < vweeters[channel].length; i++){
        var vweeter = vweeters[channel][i];
        var key = vweeter.key;
        if (key == checkID){
            j = i + 1;
            if (j >= vweeters[channel].length) j = 0;
            indexOf = i;
            isExist = true;
            break;
        }
    }

    callback(isExist, indexOf);
}

checkNewVweeter = (channel, callback) => {
    var isExist = false;
    var vweeter = null;
    for (var idx = 0; idx < vweeters[channel].length; idx++){
        vweeter = vweeters[channel][idx];
        var isPlayed = vweeter.isPlayed;
        if (isPlayed == false) {
            isExist = true;
            break;
        }
    }

    return callback(isExist, vweeter);
}

checkoutBroadcast = (channel) => {
    var size = vweeters[channel].length;
    var currentOne = null;
    var duration = 0;
    if (size > 0){
        currentOne = vweeters[channel][size - 1];
        duration = currentOne.duration;
    }
    broadcastQuery = broadcastRef.child(channel);
    broadcastQuery.once('value', function(snapshot){
        if(snapshot.val() == null){
            setBroadcastValue(channel, currentOne);
            console.log('created ' + channel + ' broadcast');
        }
    });
}

playCancel = (channel) => {
    clearTimeout(timer[channel]);
}

playNext = (channel, delay) => {
    isBroadcastingStarted[channel] = true;
    timer[channel] = setTimeout(function(){
        isBroadcastingStarted[channel] = false;
        setBroadcastValue(channel, nextQueue[channel]);
    }, delay);
}

setBroadcastValue = (channel, vweeter) => {
    if (vweeter != null){
        var vweeterID = vweeter.key;
        var duration = vweeter.duration;
        var isPlayed = vweeter.isPlayed;
        broadcastRef.child(channel).set({
            'live' : {
                'idx':vweeterID,
                'isNew':!isPlayed
            },
        });

        if (vweeter.isPlayed == false){
            vweeter.isPlayed = true;
            var vweeterRef = firebase.database().ref('Vweeter/' + channel);
            vweeterRef.child(vweeter.key).set({
                'fileName': vweeter.fileName,
                'filePath': vweeter.filePath,
                'duration': vweeter.duration,
                'isPlayed': vweeter.isPlayed
            });
        }
    }
}

cleanOldvweeter = (channel) => {
    var vweeterRef = firebase.database().ref('Vweeter/' + channel);
    var queryRef = vweeterRef.limitToLast(numberOfCycle+numberOfCache+1);
    isInitializedCleaners[channel] = false;

    queryRef.on('child_removed', function(snapshot){
        if (snapshot != null) {
            if (isInitializedCleaners[channel]){
                var fileName = snapshot.val().fileName;
                deleteS3Object(fileName);
                snapshot.ref.remove();
            }
        }
    });

    queryRef.once('value', function(snapshot){
        isInitializedCleaners[channel] = true;
    });
}

deleteS3Object = (key) => {
    var s3 = new AWS.S3({
        params:{
            Bucket: aws_vweeterapp_bucket,
        }
    });

    var params = {
        Bucket: aws_vweeterapp_bucket,
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

module.exports = Vweeter;