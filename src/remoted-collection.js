'use strict';

var helpers = require('./helpers');
var remoteCache = require('./remote-cache');

function RemotedCollection (parent, path, type, sortBy, ascendant)
{
    var arr = [];
    arr.__proto__ = RemotedCollection.prototype;
    arr.list = {};
    arr.path = path;
    arr.parent = parent;
    arr.type = typeof type === 'string' ? remoteCache.getType(type):type;
    arr.typeName = arr.type ? arr.type.remotedName:'';
    arr._autoRemove = RemotedCollection.prototype._autoRemove.bind(arr);
    arr._sorting = sortBy ? arr._compileSortByParam (sortBy, ascendant) || {"_id": (ascendant !== undefined ? !!ascendant:true)} : null;
    arr.compare = RemotedCollection.prototype.compare.bind (arr);
    return arr;
}

RemotedCollection.prototype = new Array;

RemotedCollection.prototype.sortOn = function(sorting, ascendant)
{
    if (!sorting)
    {
        this._sorting = null;
    }
    this._sorting = this._compileSortByParam (sorting, ascendant);
    this.sort(this.compare);
};

RemotedCollection.prototype.contains = function(instance)
{
    return this.list.hasOwnProperty(instance.__staticName + instance._id);
};

RemotedCollection.prototype.getById = function (id, type)
{
    return this.list[(type || this.typeName)+id];
};

RemotedCollection.prototype.first = function ()
{
    return this[0];
};

RemotedCollection.prototype.last = function ()
{
    return this[this.length-1];
};

RemotedCollection.prototype.r_add = function (data)
{
    var type = remoteCache.getType(data.__type__);
    if (this.type && this.type !== type) return;
    var instance = remoteCache.get(this.type, data);
    if (instance && this._add(instance) > -1)
    {
        this.parent.dirty();
    }
};

RemotedCollection.prototype.add = function (instance, addImmediate)
{
    if (this.type && this.type !== instance.__static) return;
    if (addImmediate && this._add(instance) > -1)
    {
        this.parent.remoteExecute(this.path, false, 'add', instance._id, instance.__staticName, addImmediate);
    }
    else if(!addImmediate)
    {
        this.parent.remoteExecute(this.path, false, 'add', instance._id, instance.__staticName, addImmediate);
    }
};

RemotedCollection.prototype._add = function (instance)
{
    if (this.list.hasOwnProperty(instance.__staticName+instance._id)) return -1;
    return this._insert(instance);
};

RemotedCollection.prototype.r_insert = function (data, index, replace)
{
    var type = remoteCache.getType(data.__type__);
    if (this.type && this.type !== type) return;
    var instance = remoteCache.get(this.type, data);
    if (instance && this._insert(instance, index, replace) > -1)
    {
        this.parent.dirty();
    }
};

RemotedCollection.prototype.insert = function (instance, index, replace, addImmediate)
{
    if (this.type && this.type !== instance.__static) return;
    if (addImmediate && this._insert(instance, index) > -1)
    {
        this.parent.remoteExecute(this.path, false, 'insert', instance._id, instance.__staticName, index, replace, addImmediate);
    }
    else if (!addImmediate)
    {
        this.parent.remoteExecute(this.path, false, 'insert', instance._id, instance.__staticName, index, replace, addImmediate);
    }
};

RemotedCollection.prototype._insert = function (instance, index, replace)
{
    var id = instance.__staticName + instance._id;
    var idx = -1;
    var deleted;
    var replaced;
    if (this.list.hasOwnProperty(id))
    {
        idx = this.indexOf(this.list[id]);
        if (idx > -1) deleted = this.splice(idx, 1)[0];
        index = index === null || isNaN(index) || index < 0 ? (idx > -1 ? idx:this.length):index;
    }
    else
    {
        index = index === null || isNaN(index) || index < 0 ? this.length:index;
    }

    if (this._sorting)
    {
        if (replace && index<this.length)
        {
            replaced = this.splice(index, 1)[0];
        }
        index = 0;
        while (index<this.length && this.compare(instance, this[index])>0)
        {
            index++;
        }
        this.splice(index,0,instance);
    }
    else if (index >= this.length)
    {
        this[index] = instance;
    }
    else if (replace && index>-1)
    {
        replaced = this.splice(index, 1, instance)[0];
    }
    else
    {
        this.splice(index,0,instance);
    }
    this.list[id] = instance;
    if (deleted !== instance && replaced !== instance)
    {
        if (typeof this.onAdded === 'function') this.onAdded.call(this, instance, index);
        instance.once('destroy', this._autoRemove);
    }
    return index;
};

RemotedCollection.prototype.r_remove = function (data)
{
    var type = remoteCache.getType(data.__type__);
    if (this.type && this.type !== type) return;
    var instance = remoteCache.get(type, data);
    if (instance && this._remove(instance))
    {
        this.parent.dirty();
    }
};

RemotedCollection.prototype.remove = function (instance, immediate)
{
    if (immediate)
    {
        if (this._remove(instance))
        {
            this.parent.remoteExecute(this.path, false, 'remove', instance._id, instance.__staticName, immediate);
        }
    }
    else
    {
        this.parent.remoteExecute(this.path, false, 'remove', instance._id, instance.__staticName, immediate);
    }
};

RemotedCollection.prototype._remove = function (instance)
{
    var id = instance.__staticName + instance._id;
    if (!this.list.hasOwnProperty(id)) return false;
    delete this.list[id];
    for(var i = 0, l = this.length; i<l; i++)
    {
        if (this[i].__staticName + this[i]._id === id)
        {
            this.splice(i,1);
            if (typeof this.onRemoved === 'function') this.onRemoved.call(this, instance);
            break;
        }
    }
    return true;
};

RemotedCollection.prototype.r_move = function (data, from, to)
{
    var type = remoteCache.getType(data.__type__);
    if (this.type && this.type !== type) return;
    var instance = remoteCache.get(this.type, data);
    if (instance && this._move(instance, from, to))
    {
        this.parent.dirty();
    }
};

RemotedCollection.prototype.move = function (instance, from, to, addImmediate)
{
    if (this.type && this.type !== instance.__static) return;
    if (addImmediate && this._move(instance, from, to))
    {
        return this.parent.remoteExecute(this.path, false, 'move', instance._id, instance.__staticName, from, to, false);
    }
    else if (!addImmediate)
    {
        return this.parent.remoteExecute(this.path, false, 'move', instance._id, instance.__staticName, from, to, true);
    }
};

RemotedCollection.prototype._move = function (instance, from, to)
{
    if (this._sorting) return false;
    if (to > this.length-1 || from < 0) return false;
    if (this.indexOf(instance) !== from) return false;

    this.splice(to, 0, this.splice(from, 1)[0]);

    return true;
};

RemotedCollection.prototype.sync = function (data)
{
    if (!Array.isArray(data)) return false;
    var newInstances = [];
    var instance;
    var toRemove = angular.copy(this.list);

    for (var i = 0, l = data.length; i<l; i++)
    {
        if (this.type)
        {
            if (!(data[i] instanceof this.type))
            {
                instance = remoteCache.get(this.type, data[i]);
                if (!instance) continue;
            }
            else instance = data[i];
        }
        else
        {
            var type = remoteCache.getType(data[i].__type__);
            if (!type) continue;
            if (!(data[i] instanceof type))
            {
                instance = remoteCache.get(type, data[i]);
                if (!instance) continue;
            }
            else instance = data[i];
        }

        if (!this.contains(instance))
        {
            newInstances.push (instance);
        }
        else
        {
            instance.update(data[i]);
        }
        delete toRemove[instance.__staticName + instance._id];
    }
    for (var i in toRemove)
    {
        this.remove(toRemove[i]);
    }
    for (var i = 0, l = newInstances.length; i<l; i++)
    {
        this.add (newInstances[i]);
    }
};

RemotedCollection.prototype._sync = function (data, circularMap)
{
    if (!Array.isArray(data)) return false;
    var newInstances = [];
    var instance;
    var toRemove = angular.copy(this.list);
    var dirty = false;

    for (var i = 0, l = data.length; i<l; i++)
    {
        if (this.type)
        {
            if (!(data[i] instanceof this.type))
            {
                instance = remoteCache.get(this.type, data[i]);
                if (!instance) continue;
            }
            else instance = data[i];
        }
        else
        {
            var type = remoteCache.getType(data[i].__type__);
            if (!type) continue;
            if (!(data[i] instanceof type))
            {
                instance = remoteCache.get(type, data[i]);
                if (!instance) continue;
            }
            else instance = data[i];
        }
        var id = instance.__staticName + instance._id;
        if (!this.contains(instance))
        {
            newInstances.push (instance);
        }
        else if (circularMap)
        {
            if (!circularMap.hasOwnProperty(id))
            {
                circularMap[id] = true;
                instance.update(data[i], null, circularMap);
            }
        }
        else 
        {
            instance.update(data[i]);
        }
        delete toRemove[id];
    }
    for (var i in toRemove)
    {
        dirty = true;
        this._remove(toRemove[i]);
    }
    if (newInstances.length > 0) dirty = true;
    for (var i = 0, l = newInstances.length; i<l; i++)
    {
        this._add (newInstances[i]);
    }
    return dirty;
};

RemotedCollection.prototype._autoRemove = function (instance)
{
    this.r_remove({__type__: instance.__staticName, _id: instance._id});
};

RemotedCollection.prototype.r_clear = function ()
{
    this._clear();
    this.parent.dirty();
};

RemotedCollection.prototype.clear = function ()
{
    this._clear();
    this.parent.remoteExecute(this.path, false, 'clear');
};

RemotedCollection.prototype._clear = function ()
{
    var clearedList = this.list;
    this.length = 0;
    for (var i in this.list)
    {
        delete this.list[i];
    }
    for (var i in clearedList)
    {
        clearedList[i].removeListener('destroy', this._autoRemove);
        if (typeof this.onRemoved === 'function') this.onRemoved.call(this, clearedList[i]);
    }
};

RemotedCollection.prototype.compare = function (a, b)
{
    for (var i in this._sorting)
    {
        a = helpers.pathValue (i, a);
        b = helpers.pathValue (i, b);
        if (typeof a === 'string')
        {
            switch (a.localeCompare (b))
            {
                case 1:
                    return this._sorting[i] ? 1:-1;
                case -1:
                    return this._sorting[i] ? -1:1;
            }
        }
        else
        {
            if (b>a)
                return this._sorting[i] ? -1:1;
            if (a>b)
                return this._sorting[i] ? 1:-1;
        }
    }
    return 0;
};

RemotedCollection.prototype._compileSortByParam = function (sortBy, ascendant)
{
    var p;
    if (typeof sortBy == 'string')
    {
        sortBy = sortBy.split (' ');
    }
    else if (!Array.isArray(sortBy))
    {
        return sortBy;
    }
    ascendant = ascendant !== undefined ? (ascendant ? true:false):true;
    p = {};
    for (var i = 0, l = sortBy.length; i<l; i++)
    {
        p[sortBy[i]] = ascendant;
    }
    return p;
};

module.exports = RemotedCollection;
