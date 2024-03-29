// new version populates a request queue with requests for a users data

window.API_KEY = '974a5ebc077564f72bd639d122479d4b';

var STATE = {
  READY:     1,
  // REQUESTED: 2, // not really used
  FAILED:    3,
  SUCCESS:   4
};

var requestQueue = async.priorityQueue(function (id, callback) {

  LocalDb.requests().get(id)
    .then(function(doc){
      if(!doc) console.log("no doc, race condition?", id)
      return request(doc.request)
    })
    .then(function(data){
      return LocalDb.requests().update(id, {
        state: STATE.SUCCESS,
        response: extractTracks(data)
      })
    }, function(){
      return LocalDb.requests().update(id, {
        state: STATE.FAILED,
      })
    })
    .then(callback);

}, 2);

requestQueue.pause();

// this will be removed when we kill the list
requestQueue.drain = function() {
    console.log('all items have been processed');
}

function extend(target, objects){
  return Array.prototype.slice.call(arguments, 1)
    .reduce(function(target, object){
      Object.keys(object).forEach(function(k){
        target[k] = object[k];
      })
      return target
    }, target)
}

function requestRecentTracks(opts){
  return extend({
    method:'user.getrecenttracks',
    limit: 200,
    page: 1,
  }, opts)
}

// make a request to the api
function request(data){
  return reqwest({
    url:"https://ws.audioscrobbler.com/2.0/",
    data: extend({api_key: window.API_KEY}, data),
    type: data.format || 'xml'
  })
}


// queue items in the local queue
function enqueue(){

  // clear all items
  requestQueue.kill()

  // enqueue pending requests
  LocalDb.requests()
    .where('state').equals(STATE.READY)
    // .limit(3)
    .each(function(d,c){
      var id = c.primaryKey;
      var priority = d.priority || 100;

      requestQueue.push(id,priority);
    })
}
enqueue();


function extractPageCount(doc){
  var recenttracks = doc.evaluate('lfm/recenttracks', doc, null, XPathResult.ANY_TYPE, null).iterateNext()
  return parseInt(recenttracks.getAttribute('totalPages'), 10)
}

function extractUser(doc){
  var recenttracks = doc.evaluate('lfm/recenttracks', doc, null, XPathResult.ANY_TYPE, null).iterateNext()
  return recenttracks.getAttribute('user')
}

function extractFirstTrackTime(doc){
  var date = doc.evaluate('lfm/recenttracks/track/date', doc, null, XPathResult.ANY_TYPE, null).iterateNext()
  return parseInt(date.getAttribute('uts'), 10)
}

// extract the data from the xml response
function extractTracks(doc){

  // probably nicer ways to do this
  var arr = [];
  var track, obj, child;
  var tracks = doc.evaluate('lfm/recenttracks/track', doc, null, XPathResult.ANY_TYPE, null)
  while (track = tracks.iterateNext()){
    obj = {};
    for (var i = track.childNodes.length - 1; i >= 0; i--) {
      child = track.childNodes[i];
      if(child.tagName)
        obj[child.tagName] = child.textContent;
    };
    arr.push(obj)
  }

  return arr;
}



// entry point for ui
function add(user){
  console.log("ADD USER", user)

  return request(requestRecentTracks({user:user}))
  .then(function(doc){
    var pages = extractPageCount(doc);
    var start = extractFirstTrackTime(doc);
    var user  = extractUser(doc);

    var requests = new Array(pages);
    for(var p = 0; p < pages; p++){
      requests[p] = requestRecentTracks({
        user: user,
        to: start,
        page: p + 1 // start at page 1
      })
    }

    console.log("queuing %d requests", requests.length);

    return LocalDb.requestsFor(user)
      .delete()
      .then(function(){
        return Promise.all(
          requests.map(function(r){
            return LocalDb.saveRequest({
              priority: r.page,
              state: STATE.READY,
              user: r.user,
              request: r
              // response
            })
            .then(function(id){
              requestQueue.push(id, r.page)
            });
          })
        )
      })
  })
  .then(function(requests){
    console.log("queued")
  })
}




// This is a stupid function
function ui(){
  return LocalDb.requests()
    .orderBy('user')
    .uniqueKeys(function(users){
      return Promise.all(
        users.map(function(user){
          return Promise.all(Object.keys(STATE).map(function(state){
            return LocalDb.requests()
            .where('[user+state]').equals([user, STATE[state]])
            .count()
          })).then(function(counts){
            return {
              name: user,
              counts: Object.keys(STATE).reduce(function(memo, d, i){
                memo[d] = counts[i]
                return memo;
              },{})
            }
          })
        })
      )
    })
}

// h a c k y
var reloadUI = function(){
  if(reloadUI.l) return reloadUI.l()
}
reloadUI.on = function(l){
  reloadUI.l = l;
}

function renderUI(){
  React.render(
    React.createElement(Users, {store: LocalDb, ui: ui, reload: reloadUI.on, queue: requestQueue}),
    document.getElementById('content')
  );
}
renderUI()



function render() {
  if(requestQueue.paused){
    return setTimeout(function(){
      requestAnimationFrame(render);
    }, 1000)
  }
  else {
    reloadUI()
      .then(function(){
        setTimeout(function(){
          requestAnimationFrame(render);
        }, 1000)
      })
  }

}

render()
