var EventEmitter = require ('events');
var Promise = require ('bluebird');

var cookie =
{
    get: function (sKey)
    {
        return decodeURIComponent(document.cookie.replace(new RegExp("(?:(?:^|.*;)\\s*" + encodeURIComponent(sKey).replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=\\s*([^;]*).*$)|^.*$"), "$1")) || null;
    },
    set: function (sKey, sValue, vEnd, sPath, sDomain, bSecure)
    {
        if (!sKey || /^(?:expires|max\-age|path|domain|secure)$/i.test(sKey)) { return false; }
        var sExpires = "";
        if (vEnd)
        {
            switch (vEnd.constructor)
            {
                case Number:
                    sExpires = vEnd === Infinity ? "; expires=Fri, 31 Dec 9999 23:59:59 GMT" : "; max-age=" + vEnd;
                break;
                case String:
                    sExpires = "; expires=" + vEnd;
                break;
                case Date:
                    sExpires = "; expires=" + vEnd.toUTCString();
                break;
            }
        }
        document.cookie = encodeURIComponent(sKey) + "=" + encodeURIComponent(sValue) + sExpires + (sDomain ? "; domain=" + sDomain : "") + (sPath ? "; path=" + sPath : "") + (bSecure ? "; secure" : "");
        return true;
    },
    remove: function (sKey, sPath, sDomain, recursive)
    {
        if (!sKey || !this.has(sKey)) { return false; }
        var keepGoing = recursive ? 100:1;
        while (keepGoing)
        {
            document.cookie = encodeURIComponent(sKey) + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT" + ( sDomain ? "; domain=" + sDomain : "") + ( sPath ? "; path=" + sPath : "");
            if (!sKey || !this.has(sKey) || !recursive) { return true; }
            if (!sPath || sPath == '/') { return false; }
            sPath = sPath.split ('/');
            while (sPath.pop() === ''){};
            sPath = sPath.join ('/');
            sPath = sPath || '/';
            keepGoing--;
        }
        return false;
    },
    has: function (sKey)
    {
        return (new RegExp("(?:^|;\\s*)" + encodeURIComponent(sKey).replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=")).test(document.cookie);
    },
    keys: /* optional method: you can safely remove it! */ function ()
    {
        var aKeys = document.cookie.replace(/((?:^|\s*;)[^\=]+)(?=;|$)|^\s*|\s*(?:\=[^;]*)?(?:\1|$)/g, "").split(/\s*(?:\=[^;]*)?;\s*/);
        for (var nIdx = 0; nIdx < aKeys.length; nIdx++) { aKeys[nIdx] = decodeURIComponent(aKeys[nIdx]); }
        return aKeys;
    }
};

function randomString (len, bits)
{
    bits = bits || 36;
    var outStr = "", newStr;
    while (outStr.length < len)
    {
        newStr = Math.random().toString(bits).slice(2);
        outStr += newStr.slice(0, Math.min(newStr.length, (len - outStr.length)));
    }
    return outStr.toUpperCase();
}

function Inheritor (){}
Inheritor.prototype.inherits = function (constructor)
{
    inherits (constructor, this);
}

function inherits (constructor, superConstructor)
{
    var inheritor = new Inheritor (constructor);
    constructor.prototype = Object.create(superConstructor.prototype);
    constructor.prototype.__static = constructor;
    constructor.prototype.__staticName = getFunctionName(constructor);
    constructor.__super = superConstructor;
    constructor.__superName = getFunctionName(superConstructor);
    constructor.inherits = inheritor.inherits;
}

function asEventEmitter (constructor)
{
    inherits (constructor, EventEmitter);
    constructor.prototype.addListeners = addListeners;
    constructor.prototype.removeListeners = removeListeners;
}

function implementsEventEmitter (obj, emitterOptions)
{
    if (!obj.__proto__.__isEmitter__)
    {
        obj.__proto__.__isEmitter__ = true;
        obj.__proto__.on = function () {this.__emitter__.on.apply(this, arguments)};
        obj.__proto__.once = function () {this.__emitter__.once.apply(this, arguments)};
        obj.__proto__.emit = function () {this.__emitter__.emit.apply(this, arguments)};
        obj.__proto__.addListener = function () {this.__emitter__.addListener.apply(this, arguments)};
        obj.__proto__.removeListener = function () {this.__emitter__.removeListener.apply(this, arguments)};
        obj.__proto__.removeAllListeners = function () {this.__emitter__.removeAllListeners.apply(this, arguments)};
        obj.__proto__.off = function () {this.__emitter__.off.apply(this, arguments)};
        obj.__proto__.addListeners = addListeners;
        obj.__proto__.removeListeners = removeListeners;
    }
    obj.__emitter__ = new EventEmitter(emitterOptions);
}

function addListeners (listeners)
{
    for (var i in listeners)
    {
        this.on(i,listeners[i]);
    }
    return this;
}

function removeListeners (listeners)
{
    for (var i in listeners)
    {
        this.removeListener(i,listeners[i]);
    }
    return this;
}

function addListenersTo (target, listeners)
{
    for (var i in listeners)
    {
        target.on(i,listeners[i]);
    }
    return target;
}

function removeListenersFrom (target, listeners)
{
    for (var i in listeners)
    {
        target.removeListener(i,listeners[i]);
    }
    return target;
}

function getEventEmitter (config)
{
    return new EventEmitter(config);
};

function getFunctionName (fn)
{
    var f = typeof fn == 'function';
    var s = f && ((fn.name && ['', fn.name]) || fn.toString().match(/function ([^\(]+)/));
    return (!f && 'not a function') || (s && s[1] || 'anonymous');
};

function defer (thisArg)
{
    var resolve, reject;
    var promise = new Promise(function()
    {
        resolve = arguments[0];
        reject = arguments[1];
    }).bind(thisArg);
    var defer = {
        resolve: function () {defer.settled = true; resolve.apply(this, arguments)},
        reject: function () {defer.settled = true; reject.apply(this, arguments)},
        promise: promise,
        settled: false
    };
    return defer;
}

function pathValue (path, obj)
{
    path = path.split ('.');
    var value;
    for (var i = 0, l = path.length; i<l; i++)
    {
        if (obj === undefined)
        {
            var t = 1;
        }
        obj = obj[path[i]];
        if (typeof value === 'object') continue;
        value = obj;
        break;
    }
    if (i >= path.length-1)
    {
        return value;
    }
}

var SPECIAL_CHARS_REGEXP = /([\:\-\_]+(.))/g;
var MOZ_HACK_REGEXP = /^moz([A-Z])/;

function camelCase (name)
{
    return name.
    replace(SPECIAL_CHARS_REGEXP, function(_, separator, letter, offset)
    {
        return offset ? letter.toUpperCase() : letter;
    }).
    replace(MOZ_HACK_REGEXP, 'Moz$1');
}

function sendWindowMessage (window, eventName)
{
    var args = [eventName].concat(Array.prototype.slice.call(arguments, 2, arguments.length));
    window.postMessage(args, "*");
}


var util = {
    'cookie': cookie
,   'randomString': randomString
,   'getFunctionName': getFunctionName
,   'inherits': inherits
,   'asEventEmitter': asEventEmitter
,   'implementsEventEmitter': implementsEventEmitter
,   'getEventEmitter': getEventEmitter
,   'defer': defer
,   'pathValue': pathValue
,   'addListenersTo': addListenersTo
,	'removeListenersFrom': removeListenersFrom
,	'camelCase': camelCase
,	'sendWindowMessage': sendWindowMessage
,	'noop': function(){}
,   'EventEmitter': EventEmitter
};

module.exports = util;