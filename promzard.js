module.exports = promzard

var fs = require('fs')
var vm = require('vm')
var util = require('util')
var files = {}
var crypto = require('crypto')
var EventEmitter = require('events').EventEmitter
var read = require('read')

var Module = require('module').Module
var path = require('path')

function promzard (file, ctx, cb) {
  if (typeof ctx === 'function') cb = ctx, ctx = null;
  if (!ctx) ctx = {};
  var pz = new PromZard(file, ctx)
  pz.on('error', cb)
  pz.on('data', function (data) {
    cb(null, data)
  })
}

function PromZard (file, ctx) {
  if (!(this instanceof PromZard))
    return new PromZard(file, ctx)
  EventEmitter.call(this)
  this.file = file
  this.ctx = ctx
  this.unique = crypto.randomBytes(8).toString('hex')
  this.load()
}

PromZard.prototype = Object.create(
  EventEmitter.prototype,
  { constructor: {
      value: PromZard,
      readable: true,
      configurable: true,
      writable: true,
      enumerable: false } } )

PromZard.prototype.load = function () {
  if (files[this.file])
    return this.loaded()

  fs.readFile(this.file, 'utf8', function (er, d) {
    if (er)
      return this.emit('error', er)
    files[this.file] = d
    this.loaded()
  }.bind(this))
}

PromZard.prototype.loaded = function () {
  this.ctx.prompt = this.makePrompt()
  this.ctx.__filename = this.file
  this.ctx.__dirname = path.dirname(this.file)
  this.ctx.__basename = path.basename(this.file)
  var mod = this.ctx.module = this.makeModule()
  this.ctx.require = function (path) {
    return mod.require(path)
  }
  this.ctx.require.resolve = function(path) {
    return Module._resolveFilename(path, mod);
  }
  this.ctx.exports = mod.exports

  this.script = this.wrap(files[this.file])
  var fn = vm.runInThisContext(this.script, this.file)
  var args = Object.keys(this.ctx).map(function (k) {
    return this.ctx[k]
  }.bind(this))
  this.result = fn.apply(this.ctx, args)
  this.walk()
}

PromZard.prototype.makeModule = function (path) {
  var mod = new Module(path, module)
  mod.loaded = true
  mod.filename = this.file
  return mod
}

PromZard.prototype.wrap = function (body) {
  var s = '(function( %s ) { return %s\n })'
  var args = Object.keys(this.ctx).join(',')
  return util.format(s, args, body)
}

PromZard.prototype.makePrompt = function () {
  this.prompts = []
  return prompt.bind(this)
  function prompt () {
    var p, d, t
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i]
      if (typeof a === 'string' && p)
        d = a
      else if (typeof a === 'string')
        p = a
      else if (typeof a === 'function')
        t = a
    }

    try { return this.unique + '-' + this.prompts.length }
    finally { this.prompts.push([p, d, t]) }
  }
}

PromZard.prototype.walk = function (o, cb) {
  o = o || this.result
  cb = cb || function (er, res) {
    if (er)
      return this.emit('error', er)
    this.result = res
    return this.emit('data', res)
  }
  cb = cb.bind(this)
  var keys = Object.keys(o)
  var i = 0
  var len = keys.length

  L.call(this)
  function L () {
    while (i < len) {
      var k = keys[i]
      var v = o[k]
      i++

      if (v && typeof v === 'object') {
        return this.walk(v, function (er, res) {
          if (er) return cb(er)
          o[k] = res
          L.call(this)
        }.bind(this))
      } else if (v &&
                 typeof v === 'string' &&
                 v.indexOf(this.unique) === 0) {
        var n = +v.substr(this.unique.length + 1)
        var prompt = this.prompts[n]
        if (isNaN(n) || !prompt)
          continue

        // default to the key
        if (undefined === prompt[0])
          prompt[0] = k

        return this.prompt(prompt, function (er, res) {
          o[k] = res
          L.call(this)
        }.bind(this))
      }
    }
    // made it to the end of the loop, maybe
    if (i >= len)
      return cb(null, o)
  }
}

PromZard.prototype.prompt = function (pdt, cb) {
  var prompt = pdt[0]
  var def = pdt[1]
  var tx = pdt[2]

  if (tx)
    cb = function (cb) { return function (er, data) {
      return cb(er, data ? tx(data) : null)
    }}(cb)

  read({ prompt: prompt + ': ' , default: def }, cb)
}

