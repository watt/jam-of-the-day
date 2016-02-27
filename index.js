var SpotifyWebApi = require('spotify-web-api-node');
var creds = {
	clientId: process.env.SPOTIFY_CLIENT_ID,
	clientSecret: process.env.SPOTIFY_CLIENT_SECRET
};
var spotifyApi = new SpotifyWebApi(creds);
var spotifyUser = process.env.SPOTIFY_USERNAME;
var spotifyPlaylistId = process.env.SPOTIFY_PLAYLIST;

var slack = require('slack-notify')(process.env.SLACK_URL);

var fs = require('fs');
var redis = require('redis');


Date.prototype.isValid = function() {
	// An invalid date object returns NaN for getTime() and NaN is the only
	// object not strictly equal to itself.
	return this.getTime() === this.getTime();
};

var start = false;

function grantClient() {
	spotifyApi.clientCredentialsGrant().then(function(data) {
		console.log('Got new access token, valid for', data.expires_in, 'seconds');
		spotifyApi.setAccessToken(data.access_token);
		start = true;
		setTimeout(grantClient, data.expires_in * 1000);
	}, function(err) {
		console.log('Something went wrong when retrieving an access token', err);
		process.exit(1);
	});
}

var client;
var fetchPlaylist = function() {
		var lastDate;
		var writeLastDate;
		var writeLastOffset;
		var lastOffset;
		if (process.env.REDISTOGO_URL) {
			console.log("using redis");
			var rtg = require("url").parse(process.env.REDISTOGO_URL);
			client = redis.createClient(rtg.port, rtg.hostname);
			client.auth(rtg.auth.split(":")[1]);
			client.on("error", function(err) {
				console.log("Redis - Error " + err);
			});
			client.get("lastDate", function(err, value) {
				if (!err) {
					lastDate = new Date(value);
				}
			});
			client.get("offset", function(err, value){
				if(!err){
					lastOffset = value;
				}
			});
			writeLastDate = function(date) {
				client.set('lastDate', date);
			};
			writeLastOffset = function(offset){
				client.set('offset', offset);
			}
		} else {
			console.log("using filesystem");
			var contents = fs.readFileSync('./last_date.txt');
			console.log(contents.toString());
			lastDate = new Date(contents.toString());
			console.log('lastdate isValid ' + lastDate.isValid());
			writeLastDate = function(date) {
				fs.writeFile("./last_date.txt", date, function() {});
			};
			writeLastOffset = function(offset){
				fs.writeFile("./last_offset.txt", offset, function(){});
			}
			lastOffset = fs.readFileSync('./last_offset.txt').toString();
		}

		return function() {
			if (!start) {
				return;
			}
			console.log("Last fetched at:", lastDate);
			var offset = (lastOffset.length != 0 ? lastOffset : "0");
			console.log("requesting at offset: " + offset);
			spotifyApi.getPlaylistTracks(spotifyUser, spotifyPlaylistId, {
				offset: offset
			}).then(function(data) {
				for (var i in data.items) {
          var item = data.items[i];
					var date = new Date(item.added_at);
					if (!date.isValid() || date > lastDate) {
            console.log('posting new track');

            var artistsStr = item.track.artists.map(function(a) {
              return a.name;
            }).join(', ');
            console.log(artistsStr);

            var albumName = item.track.album.name;
            console.log(albumName);

            var albumThumbnailUrl = item.track.album.images[1].url;
            console.log(albumThumbnailUrl);

						post("jam of the day",
              "https://open.spotify.com/user/121317829/playlist/14A92O7ujDdxRb1dwuh2mJ",
              item.added_by.id,
              item.track.name,
              artistsStr,
              albumName,
              albumThumbnailUrl
            );

						lastDate = date;
						writeLastDate(lastDate);
					}
				}
				if(data.total > (data.limit + data.offset))
				{
					lastOffset = data.limit + data.offset;
					console.log("writing offset: " + lastOffset);
					writeLastOffset(lastOffset.toString());
				}
			}, function(err) {
				console.log('Something went wrong!', err);
			});
		};
	};

slack.onError = function(err) {
	console.log('API error:', err);
};
var slacker = slack.extend({
	username: 'Spotify',
	unfurl_media: false
});

function post(list_name, list_url, added_by, trackname, artists, album, albumArtUrl) {
  var usernameHash = {
      '121317829': 'Jordan Degner',
      '1266290672': 'Josh Petro',
      '1215629430': 'Josh Cox',
  };

  if (!isNaN(added_by) && added_by in usernameHash) {
      added_by = usernameHash[added_by];
  }

  var attachment = [{
    color: 'success',
    title: 'New track added by ' + added_by + ' - "' + trackname + '" by ' + artists,
    title_link: list_url,
    text: 'Added to ' + list_name + ' by ' + added_by,
    fields: [
      {
        title: 'Artist',
        value: artists,
        short: true,
      },
      {
        title: 'Album',
        value: album,
        short: true,
      },
    ],
    thumb_url: albumArtUrl,
  }];

  console.log(attachment);

	slacker({
		attachment: attachment,
	});
}

grantClient();
setInterval(fetchPlaylist(), 1000 * 10);
