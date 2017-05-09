'use strict';

var Remoted = require ('./remoted')
,   io = require('socketio-client')
,	objectPath = require ('object-path')
,   remoteCache = require('./remote-cache');

var _uid;
var _executeUid = 0;
var _callbackTimeout = 10000;

function RemoteService ()
{
    this._sockets = {};
    $rootScope.initialized = this.connected = {};
    $rootScope.initialized = this.initialized = {};
    this._initializedDefered = {};
    this.initialData = {};

    this._syncRules = {};
    this.currentNamespace = '';
    this._newInstanceBuffer = {};

    RemoteService.__super.call
    ({
        newListener: true,
        maxListeners: 20
    });

    this._newInstanceBufferingHandler = newInstanceBufferingHandler.bind(this);
    this._newInstanceDefaultHandler = newInstanceDefaultHandler.bind(this);
    this.executeSyncRules = this.executeSyncRules.bind(this);
    this.newInstanceBufferStarted = false;
    this._hasNewInstance = false;
    this._socketsHandlers = {};
    this._windowHandlers = {};
    remoteCache.watcher.on ('new', this._newInstanceDefaultHandler)
}

util.asEventEmitter (RemoteService);

RemoteService.prototype.connect = function (namespace, path, ssid)
{
    if (this.connected[namespace]) return;
    var self = this;
    this.initialized[namespace] = false;
    if (this._initializedDefered[namespace] && !this._initializedDefered[namespace].settled) this._initializedDefered[namespace].cancel();
    this._initializedDefered[namespace] = util.defer(this);
    _uid = util.randomString (128);
    if (this._sockets[namespace]) util.removeListenersFrom(this._sockets[namespace], this._socketsHandlers[namespace]);
    if (!this._syncRules.hasOwnProperty(namespace)) this._syncRules[namespace] = {sync:{}, update:{}};
    this.currentNamespace = namespace;
    var p = '';
    var s = $location.search();
    if (Object.keys(s).length > 0)
    {
        p = [];
        for (var i in s)
        {
            p.push (i + '=' + encodeURIComponent(s[i]));
        }
        p = '&' + p.join('&')
    }
    console.log ('Remote connect to '+namespace);
    var _socket = this._sockets[namespace] = io (namespace, {
        multiplex: false
        ,   query: "uid="+_uid+p+'&nsp='+namespace+(ssid ? '&ssid='+ssid:'')
        ,   path: path
        ,   reconnection: true
        ,	reconnectionDelay: 100
        ,	reconnectionDelayMax: 1000
        ,	timeout: 5000
    });
    if (!this.mainSocket || !this.mainSocket.connected) this.mainSocket =_socket;

    this._socketsHandlers[namespace] =
    {
        'connect': function ()
        {
            if (!self.mainSocket || !self.mainSocket.connected ) self.mainSocket = _socket;
            self.connected[namespace] = true;
            console.log (namespace +':Socket connected');
            self.emit('connect');
            $rootScope.$applyAsync();
        }
    ,	'error': function (error)
        {
            console.log(namespace + ':Socket connect error');
            console.log(error);
            if (!self._initializedDefered[namespace].settled) self._initializedDefered[namespace].reject(namespace + " : " + error);
            if (error == "Authentication error")
            {
                this.emit('authentication-error');
            }
            else
            {
                //self.emit('error', error);}
            }
        }
    ,	'disconnect': function ()
        {
            console.log (namespace +  ' : remote service disconnected');
            if (self.mainSocket && self.mainSocket.connected)
            {
                for (var i in self._sockets)
                {
                    if (self._sockets[i].connected)
                    {
                        self.mainSocket = self._sockets[i];
                        break;
                    }
                }
            }
            self.connected[namespace] = false;
            console.log (namespace + ' : Socket disconnected');
            self.emit('disconnect');
            $rootScope.$applyAsync();
        }
    ,	'remote-init': _initHandler.bind(this, _socket, namespace)
    ,	'remote-kill': _killHandler.bind(this, _socket, namespace)
    ,	'is-alive': _isAliveHandler.bind(this, _socket, namespace)
    };

    util.addListenersTo(_socket, this._socketsHandlers[namespace]);

    if (this._windowHandlers[namespace]) window.removeEventListener('unload',  this._windowHandlers[namespace]);

    this._windowHandlers[namespace] = function ()
    {
        console.log ( namespace + ' : unload disconnect');
        _socket.disconnect();
    };
    window.addEventListener('unload',  this._windowHandlers[namespace]);
    return this.initialize();
};

RemoteService.prototype.disconnect = function (namespace)
{
    this.emit ('manual-disconnect', namespace);
    if (namespace)
    {
        if (this._sockets.hasOwnProperty(namespace)) this._sockets[namespace].disconnect();
    }
    else
    {
        for (var i in this._sockets)
        {
            this._sockets[i].disconnect();
        }
    }
};

function _nextExecuteUid ()
{
    if (_executeUid > 9999) _executeUid = 0;
    return _executeUid = _executeUid+1;
}
/**
* @param {string} type
* @param {string} id
* @param {string} method
**/
RemoteService.prototype.execute = function (type, id, method, hasCallback)
{
    return this._remoteCommand ('execute', [type, id, method].concat(Array.prototype.slice.call(arguments, 4)), hasCallback);
};

RemoteService.prototype.update = function (instance, fields, hasCallback)
{
    var type = instance.__staticName;
    if (Array.isArray(fields))
    {
        if (fields.indexOf ('_id') == -1) fields.push('_id');
    }
    else if (fields != '_id')
    {
        fields = [fields, '_id'];
    }
    return this._remoteCommand('update', [type, instance.toJSON(fields, false)], hasCallback);
};

RemoteService.prototype.create = function (type, data, hasCallback)
{
    return this._remoteCommand('create', [type, data], hasCallback);
};

RemoteService.prototype.destroy = function (instance, hasCallback)
{
    var type = instance.__staticName;
    var self = this;
    return this._remoteCommand('destroy', [type, instance._id], hasCallback).then(function()
    {
        instance.r_destroy();
        self.emit ('destroy'+type, instance);
    });
};

RemoteService.prototype._remoteCommand = function (command, args, hasCallback)
{
    console.debug (command + ' sent');
    console.debug (args);

    if (hasCallback)
    {
        var self = this;
        return new Promise (function (resolve, reject)
        {
            var uid = _nextExecuteUid();
            self.mainSocket.emit.apply (self.mainSocket, ['remote-'+command, uid].concat(args));
            var to = $timeout(function ()
            {
                self.mainSocket.removeEventListener ('remote-execute-callback-'+uid);
                reject(new Error ('server timeout for '+command+'callback : '+uid));
                console.debug (args);
            }, _callbackTimeout, false);
            self.mainSocket.once('remote-'+command+'-callback-'+uid, function (result)
            {
                $timeout.cancel(to);
                console.debug (command + ' callback received : '+uid);
                console.debug (result);
                switch (typeof result)
                {
                    case 'object' :
                        if (result != null)
                        {
                            if (result.fulfilled)
                            {
                                resolve (result.value);
                                break;
                            }
                            else	if (result.error)
                            {
                                reject (new Error (result.reason));
                                break;
                            }
                            else if (result.reject)
                            {
                                reject (result.reason);
                                break;
                            }
                        }
                        else
                        {
                            reject (new Error ("server returned null"));
                            break;
                        }
                    default:
                        resolve (result);
                }
            });
        });
    }
    else
    {
        this.mainSocket.emit.apply (this.mainSocket, ['remote-'+command, false].concat(args));
    }
};

Object.defineProperty (RemoteService.prototype, 'syncRules',
{
    get: function ()
    {
        return this._syncRules[this.currentNamespace];
    }
});

RemoteService.prototype.syncRequest = function (type)
{
    console.debug ('sync request sent : "'+type+'"');
    this.mainSocket.emit.call (this.mainSocket, 'remote-sync-request', type);
};

RemoteService.prototype.updateRequest = function (type, id)
{
    console.debug ('update request sent : "'+type+'" - id : '+id);
    this.mainSocket.emit.call (this.mainSocket, 'remote-update-request', type, id);
};

RemoteService.prototype.syncRule = function (action, arg1, arg2)
{
    var type;
    switch (action)
    {
        case 'sync':
            this.syncRules.sync[arg1] = true;
            if (arg2 === true && this.initialized)
            {
                var self = this;
                window.setTimeout(function()
                {
                    self.syncRequest(arg1);
                });
            }
        break;
        case 'update':
            if (!Array.isArray (arg1)) arg1 = [arg1];
            for (var i = 0, l = arg1.length; i<l; i++)
            {
                if (arg1[i] instanceof Remoted)
                {
                    type = arg1[i].__staticName;
                    arg1[i] = remoteCache.idOf (arg1[i]);
                }
                else
                {
                    switch (typeof arg1[i])
                    {
                        case 'string':
                            type = arg1[i];
                        break;
                        case 'function':
                            type = util.getFunctionName(arg1[i]);
                        break;
                        default:
                            continue;
                    }
                }
                if (!this.syncRules.update.hasOwnProperty (type)) this.syncRules.update[type] = {};
                this.syncRules.update[type][arg1[i]] = true;
                if (arg2 === true && this.initialized) this.updateRequest (type, arg1[i]);
            }
        break;
    }
};

RemoteService.prototype.executeSyncRules = function (rules)
{
    if (!this.initialized) return;
    rules = rules || this.syncRules;
    if (rules.hasOwnProperty ('update'))
    {
        var updates;
        var i;
        for (var type in rules.update)
        {
            updates = [];
            for (i in rules.update[type])
            {
                updates.push (i);
            }
            this.updateRequest (type, updates);
        }
    }
    if (rules.hasOwnProperty ('sync'))
    {
        for (var type in rules.sync)
        {
            this.syncRequest (type);
        }
    }
};

RemoteService.prototype.startNewInstanceBuffer = function ()
{
    if (this.newInstanceBufferStarted) return;
    remoteCache.watcher.removeListener ('new', this._newInstanceDefaultHandler)
    remoteCache.watcher.on ('new', this._newInstanceBufferingHandler);
    this.newInstanceBufferStarted = true;
};

RemoteService.prototype.flushNewInstanceBuffer = function (stop)
{
    if (this._hasNewInstance)
    {
        for (var i in this._newInstanceBuffer)
        {
            this.emit ('new'+i, this._newInstanceBuffer[i].splice(0, this._newInstanceBuffer[i].length));
        }
        this._hasNewInstance = false;
    }
    if (stop) this.stopNewInstanceBuffer();
}

RemoteService.prototype.stopNewInstanceBuffer = function ()
{
    if (!this.newInstanceBufferStarted) return;
    remoteCache.watcher.removeListener ('new', this._newInstanceBufferingHandler);
    remoteCache.watcher.on ('new', this._newInstanceDefaultHandler)
    this.newInstanceBufferStarted = false;
}

function newInstanceBufferingHandler (instance, type)
{
    if (!this._newInstanceBuffer.hasOwnProperty (type)) this._newInstanceBuffer[type] = [];
    this._newInstanceBuffer[type].push (instance);
    this._hasNewInstance = true;
}

function newInstanceDefaultHandler (instance, type)
{
    this.emit ('new'+type, [instance]);
}

function _initHandler (socket, namespace, inidata)
{
    if (this.initialized[namespace]) return;
    console.log (namespace + ' : INITIAL DATA : ');
    console.log (inidata);
    var self = this;
    socket.removeListener('remote-init', this._socketsHandlers[namespace]['remote-init']);
    socket.on ('remote-create', this._socketsHandlers[namespace]['remote-create'] = _createHandler.bind(this));
    socket.on ('remote-sync', this._socketsHandlers[namespace]['remote-sync'] = _syncHandler.bind(this));
    socket.on ('remote-update', this._socketsHandlers[namespace]['remote-update'] = _updateHandler.bind(this));
    socket.on ('remote-execute', this._socketsHandlers[namespace]['remote-execute'] = _executeHandler.bind(this));
    socket.on ('remote-destroy', this._socketsHandlers[namespace]['remote-destroy'] = _destroyHandler.bind(this));
    socket.on ('remote-init', this._socketsHandlers[namespace]['remote-init'] = this.executeSyncRules.bind(this, socket, namespace));

    this.initialized[namespace] = true;
    this.initialData[namespace] = inidata;

    this.serverTimeDelta = Date.parse(inidata.serverTime) - Date.now();
    console.log ('SERVER TIME DELTA : ' + this.serverTimeDelta);

    this.executeSyncRules ({sync: this.syncRules.sync});
    if ($rootScope.user && $rootScope.user.id != inidata.remoted.user.data._id || !$rootScope.user)
    {
        if ($rootScope.user)
        {
            $rootScope.user.removeListener ('dirty', _onUserDirty);
        }
        $rootScope.user = remoteCache.get(inidata.remoted.user.type, jsonCircularRemoteRevivor(inidata.remoted.user.type, inidata.remoted.user.data));
        this.user = $rootScope.user;
        delete inidata.remoted.user;
        $rootScope.user.on ('dirty', _onUserDirty);
    }
    for (var i in inidata.remoted)
    {
        try {
            inidata[i] = remoteCache.get(inidata.remoted[i].type, jsonCircularRemoteRevivor(inidata.remoted[i].type, inidata.remoted[i].data));
            this.syncRule ('update', inidata[i]);
            delete inidata.remoted[i];
        }
        catch (e)
        {
            console.debug(e);
        }
    }
    if (Object.keys(inidata.remoted).length === 0) delete inidata.remoted;
    var modules = [];
    var userModules = [];
    for (var i=0, l=inidata.modules.length; i<l; i++)
    {
        if (inidata.modules[i].userModule) userModules.push(inidata.modules[i]);
        else modules.push(inidata.modules[i]);
    }

    $rootScope.modules = $filter('orderBy')(modules, 'index');
    $rootScope.userModules = $filter('orderBy')(userModules, 'index');
    this.emit ('initialized', inidata, namespace);
    this._initializedDefered[namespace].resolve(inidata);
}

RemoteService.prototype.initialize = function (namespace)
{
    if (this.initialized[namespace])
    {
        var initialData = this.initialData[namespace];
        if (initialData.hasOwnProperty('remoted'))
        {
            for (var i in initialData.remoted)
            {
                try {
                    initialData[i] = remoteCache.get(initialData.remoted[i].type, initialData.remoted[i].data);
                    this.syncRule ('update', initialData[i]);
                    delete initialData.remoted[i];
                }
                catch (e)
                {
                    console.error(e.stack);
                }
            }
            if (Object.keys(initialData.remoted).length === 0) delete initialData.remoted;
        }
        return this._initializedDefered[namespace].promise;
    }
    else
    {
        return this._initializedDefered[namespace] ? this._initializedDefered[namespace].promise : (this._initializedDefered[namespace] = util.defer(this)).promise;
    }
};

RemoteService.prototype.serverDate = function ()
{
    return new Date(this.serverNow());
};

RemoteService.prototype.serverNow = function ()
{
    return Date.now() + this.serverTimeDelta;
};

function _onUserDirty ()
{
    $rootScope.$apply();
}

function _isAliveHandler ()
{
    this.mainSocket.emit('keep-alive');
}

function _killHandler (killdata)
{
    for (var i in this._sockets)
    {
        this._sockets[i].disconnect();
    }
    // Pas bien de le mettre là mais on verra plus tard
    $state.go('login', {killed: true, location: false});
    this.emit('kill', killdata);
}

function _createHandler (type, data)
{
    console.debug ('create received : "'+type+'"');
    jsonCircularRemoteRevivor(type, data);
    this.startNewInstanceBuffer();
    var instance = remoteCache.exists (type, data);
    if (instance)
    {
        instance.update (data);
        this.flushNewInstanceBuffer(true);
        return;
    }
    remoteCache.get (type, data);
    this.flushNewInstanceBuffer(true);
}

function _syncHandler (type, data)
{
    if (!remoteCache.isRegistered(type)) return;
    jsonCircularRemoteRevivor(type, data);
    this.startNewInstanceBuffer();
    console.debug ('sync received : "'+type+'"');
    console.debug (data);
    var newInstances = [];
    var toDestroy = angular.copy(remoteCache.all(type));
    var j;

    if (!Array.isArray(data))
    {
        data = [data];
    }
    for (var i = 0, l = data.length; i<l; i++)
    {
        var instance = remoteCache.exists (type, data[i]);
        if (instance)
        {
            instance.update(data[i]);
            delete toDestroy[remoteCache.idOf(data[i])];
        }
        else
        {
            instance = remoteCache.get (type, data[i]);
            if (instance) newInstances.push (instance);
        }
    }
    for (j in toDestroy)
    {
        toDestroy[j].r_destroy();
    }
    this.flushNewInstanceBuffer(true);

    //A REVOIR
    if (newInstances.length==0 && j != undefined)
    {
        this.emit ('destroy'+type);
    }
    this.emit ('sync'+type);
}

function _updateHandler (type, data)
{
    console.debug ('update received'+type);
    jsonCircularRemoteRevivor(type, data);
    this.startNewInstanceBuffer();
    if (!Array.isArray(data))
    {
        data = [data];
    }
    for (var i = 0, l = data.length; i<l; i++)
    {
        var instance = remoteCache.exists (type, data[i]);
        if (instance)
        {
            instance.update(data[i]);
        }
    }
    this.flushNewInstanceBuffer(true);
}

var _executeHandler = function (type, id, method)
{
    console.debug ('execute received'+method+' on '+type+' - '+id);
    this.startNewInstanceBuffer();
    var instance = remoteCache.exists (type, id);
    if (instance)
    {
        if (!(typeof instance[method] === 'function'))
        {
            if (instance.__reverseMap.hasOwnProperty(method))
            {
                if (instance.__reverseMap[method].array && instance.__reverseMap[method].propType === 'remoted' && typeof instance[method]['r_' + arguments[3]] === 'function')
                {
                    instance[method]['r_'+arguments[3]].apply(instance[method], Array.prototype.slice.call(arguments, 4).concat(this))
                }
                else if ((instance.__reverseMap[method].propType === 'property' || instance.__reverseMap[method].propType === 'remoted') && arguments.length == 4)
                {
                    var data = {};
                    data[instance.__reverseMap[method].jsonName] = arguments[3];
                    jsonCircularRemoteRevivor(type, data);
                    instance.update(data);
                }
            }
        }
        else
        {
            instance[method].apply(instance, Array.prototype.slice.call (arguments, 3));
        }
    }
    this.flushNewInstanceBuffer(true);
}

function _destroyHandler (type, data)
{
    console.debug ('destroy received : '+type);
    var instance = remoteCache.exists (type, data);
    if (instance)
    {
        instance.r_destroy();
        this.emit ('destroy'+type, instance);
    }
}

function jsonCircularRemoteRevivor (type, json, path)
{
    if (typeof type === 'string') type = remoteCache.getType(type);
    if (!type) return json;
    var obj;
    if (path)
    {
        obj = objectPath.get(json, path, false);
        if (!obj) return;
    }
    else
    {
        obj = json;
        path = '';
    }

    if (typeof type === 'function')
    {
        for (var i in type.prototype.__remotedProps)
        {
            var prop = type.prototype.__remotedProps[i];
            if (typeof obj[prop.jsonName] === 'string')
            {
                obj[prop.jsonName] = obj[prop.jsonName] ? objectPath.get(json, obj[prop.jsonName]):json;
            }
            else if (obj[prop.jsonName])
            {
                jsonCircularRemoteRevivor (prop.type, json, path+ (path ? '.':'') +prop.jsonName);
            }
        }

        for (var i in type.prototype.__remotedCollectionProps)
        {
            var prop = type.prototype.__remotedCollectionProps[i];
            if (!Array.isArray(obj[prop.jsonName])) continue;
            var collection = obj[prop.jsonName];
            for (var j = 0, l = collection.length; j<l; j++)
            {
                if (typeof collection[j] === 'string')
                {
                    collection[j] = collection[j] ? objectPath.get(json, collection[j]):json;
                }
                else
                {
                    jsonCircularRemoteRevivor (prop.type, json, path+ (path ? '.':'') +prop.jsonName+'.'+j);
                }
            }
        }
    }

    return json;
}

module.exports = new RemoteService();