var firebase      = require('firebase');
var defaultDatabase, channelRef, broadcastRef;
var channels = [];
var vweeters = {};

var isInitializedCleaners = {};
var isBroadcastingStarted = {};
var broadcasts = [];
var numberOfCycle = 5;
var numberOfCache = 3;

var AWS                = require('aws-sdk');
var vweeterapp_bucket  = 'vweeterappnortheast2/voices';

var vweetersQueue = {};
var nextQueueItem = {};
var tempQueueItem = {};
var timer = {};

Vweeter = () => {

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
    var initQuery = vweeterRef.limitToLast(numberOfCycle);

    vweeters[channel] = [];    
    isBroadcastingStarted[channel] = false;

    initQuery.once('value', function(snapshot){

        snapshot.forEach(function(obj){
            var key = obj.key;
            var duration = obj.val().duration;
            var fileName = obj.val().fileName;
            var filePath = obj.val().filePath;
            var isPlayed = obj.val().isPlayed;
            var vweeter = {
                    'key': key,
                    'fileName':fileName,
                    'filePath':filePath,
                    'duration':duration,
                    'isPlayed':isPlayed
                };
            vweeters[channel].push(vweeter);   
        });

        startBroadcastChannel(channel);
    });

    // track incoming voices
    var queryRef = vweeterRef.orderByChild('isPlayed').equalTo(false);
    queryRef.on('child_added', function(snapshot){
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
        console.log(channel + ' : child_added: ' + key);

        if (vweeters[channel].length < 2){
            console.log('setBraodcast: ' + channel + ', ' + null + ' due to less than 2.');
            setBroadcastValue(channel, null);
        }else{
            if (!isBroadcastingStarted[channel]) {
                setBroadcastValue(channel, vweeter);
            }else{

                var count = 0;
                vweeters[channel].forEach(function(element) {
                    if (element.isPlayed == false){
                        count += 1;
                    }
                });

                if (count > 1){
                    //----> in case of new vweeters exist more than 1.
                }else{
                    tempQueueItem[channel] = nextQueueItem[channel];
                    nextQueueItem[channel] = vweeter;
                }
            }
        }

    });

    queryRef.on('child_removed', function(snapshot){
        if(snapshot.val() != null){

            if (vweeters[channel].length > numberOfCycle){
                var numberOfnew = 0, numberOfold = 0; 
                vweeters[channel].forEach(function(element){
                    if (element.isPlayed){
                        numberOfold += 1;
                    }else{
                        numberOfnew += 1;
                    }
                });

                console.log('numberOfold: ' + numberOfold + '\nnumberOfnew: ' + numberOfnew);

                if (numberOfnew >= numberOfCycle){
                    // remove all old vweeters
                    for (var i = 0; i < vweeters[channel].length; i++){
                        var element = vweeters[channel][i];
                        if (element.isPlayed){
                            if (element.key != nextQueueItem[channel].key){
                                vweeters[channel].splice(i, 1);
                                console.log(channel + ': child_removed: ' + element.key);
                            }
                        }
                    }
            
                }else{
                    for (var i = 0; i < vweeters[channel].length; i++){
                        var element = vweeters[channel][i];
                        if (element.isPlayed){
                            vweeters[channel].splice(i, 1);
                            console.log(channel + ': child_removed: ' + element.key);
                            
                            break;
                        }
                    }
                }
                
            }

        }
    });

    deleteOldvweeter(channel);
}

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

updatedBroadcast = (channel, currentID, currentDuration) => {

    console.log(channel + ' updatedBroadcast: ' + currentID);
    determineNextQueueItem(channel, currentID, function(nextItem){
        playNext(channel, (currentDuration+2.0)*1000);
    });
}

determineNextQueueItem = (channel, currentID, callback) => {
    checkNewVweeter(channel, function(isExistNew, vweeter){
        var nextItem = null;
        if(isExistNew){
            checkExistVweeter(channel, currentID, function(isExist, indexOf){
                if (isExist){
                    nextItem = vweeter;
                    nextQueueItem[channel] = nextItem; 
                }
            });
        }else{
            checkExistVweeter(channel, currentID, function(isExist, indexOf){
                if (isExist){
                    var liveVweeter = vweeters[channel][indexOf];
                    if (tempQueueItem[channel]) {
                        nextItem = tempQueueItem[channel];
                        tempQueueItem[channel] = null;
                    } else {
                        var j = indexOf + 1;
                        if (j >= vweeters[channel].length) j=0;
                        nextItem = vweeters[channel][j];
                    }

                    nextQueueItem[channel] = nextItem;
                }
            });
        }

        callback(nextItem);
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

setBroadcastValue = (channel, vweeter) => {
    if (vweeter != null){
        var vweeterID = vweeter.key;
        var duration = vweeter.duration;
        var isPlayed = vweeter.isPlayed;
        broadcastRef.child(channel).set({
            'live' : {
                'idx':vweeterID,
                'isNew':!isPlayed,
                'duration': duration
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

deleteOldvweeter = (channel) => {
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