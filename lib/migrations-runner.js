// Generated by CoffeeScript 1.10.0
(function() {
  var MigrationsRunner, Promise, _, loadMigrationsFromDir, loadSpecificMigrationsFromDir, mongoConnect, normalizeConfig, ref;

  Promise = require('bluebird');

  _ = require('lodash');

  ref = require('./utils'), mongoConnect = ref.connect, normalizeConfig = ref.normalizeConfig, loadSpecificMigrationsFromDir = ref.loadSpecificMigrationsFromDir, loadMigrationsFromDir = ref.loadMigrationsFromDir;

  MigrationsRunner = (function() {
    function MigrationsRunner(dbConfig, log1) {
      this.log = log1 != null ? log1 : _.noop;
      dbConfig = normalizeConfig(dbConfig);
      this._isDisposed = false;
      this._dbReady = new Promise.fromCallback(function(cb) {
        return mongoConnect(dbConfig, cb);
      }).then((function(_this) {
        return function(db) {
          return _this._db = db;
        };
      })(this));
      this._collName = dbConfig.collection;
      this._timeout = dbConfig.timeout;
    }

    MigrationsRunner.prototype._coll = function() {
      return this._db.collection(this._collName);
    };

    MigrationsRunner.prototype._runWhenReady = function(migrations, direction, cb, progress) {
      var onError, onSuccess;
      if (this._isDisposed) {
        return cb(new Error('This migrator is disposed and cannot be used anymore'));
      }
      onSuccess = (function(_this) {
        return function() {
          var ranMigrations;
          ranMigrations = {};
          return _this._coll().find().toArray(function(err, docs) {
            var doc, j, len;
            if (err) {
              return cb(err);
            }
            for (j = 0, len = docs.length; j < len; j++) {
              doc = docs[j];
              ranMigrations[doc.id] = true;
            }
            return _this._run(ranMigrations, migrations, direction, cb, progress);
          });
        };
      })(this);
      onError = function(err) {
        return cb(err);
      };
      return this._dbReady.then(onSuccess, onError);
    };

    MigrationsRunner.prototype._run = function(ranMigrations, migrations, direction, done, progress) {
      var allDone, handleMigrationDone, i, l, log, logFn, migrationContext, migrationsCollection, migrationsCollectionUpdatePromises, result, runOne, systemLog, timeout, userLog;
      result = {};
      logFn = this.log;
      log = function(src) {
        return function(msg) {
          return typeof logFn === "function" ? logFn(src, msg) : void 0;
        };
      };
      userLog = log('user');
      systemLog = log('system');
      i = 0;
      l = migrations.length;
      migrationsCollection = this._coll();
      migrationsCollectionUpdatePromises = [];
      handleMigrationDone = function(id) {
        var p;
        p = direction === 'up' ? Promise.fromCallback(function(cb) {
          return migrationsCollection.insert({
            id: id
          }, cb);
        }) : Promise.fromCallback(function(cb) {
          return migrationsCollection.deleteMany({
            id: id
          }, cb);
        });
        return migrationsCollectionUpdatePromises.push(p);
      };
      allDone = function(err) {
        return Promise.all(migrationsCollectionUpdatePromises).then(function() {
          return done(err, result);
        });
      };
      migrationContext = {
        db: this._db,
        log: userLog
      };
      timeout = this._timeout;
      runOne = function() {
        var fn, id, isCallbackCalled, migration, migrationDone, skipCode, skipReason, timeoutId;
        if (i >= l) {
          return allDone();
        }
        migration = migrations[i];
        fn = migration[direction];
        id = migration.id;
        i += 1;
        migrationDone = function(res) {
          var msg, ref1;
          result[id] = res;
          _.defer(function() {
            return typeof progress === "function" ? progress(id, res) : void 0;
          });
          msg = "Migration '" + id + "': " + res.status;
          if (res.status === 'skip') {
            msg += " (" + res.reason + ")";
          }
          systemLog(msg);
          if (res.status === 'error') {
            systemLog('  ' + res.error);
          }
          if (res.status === 'ok' || (res.status === 'skip' && ((ref1 = res.code) === 'no_up' || ref1 === 'no_down'))) {
            return handleMigrationDone(id);
          }
        };
        skipReason = null;
        skipCode = null;
        if (!fn) {
          skipReason = "no migration function for direction " + direction;
          skipCode = "no_" + direction;
        }
        if (direction === 'up' && id in ranMigrations) {
          skipReason = "migration already ran";
          skipCode = 'already_ran';
        }
        if (direction === 'down' && !(id in ranMigrations)) {
          skipReason = "migration wasn't in the recent `migrate` run";
          skipCode = 'not_in_recent_migrate';
        }
        if (skipReason) {
          migrationDone({
            status: 'skip',
            reason: skipReason,
            code: skipCode
          });
          return runOne();
        }
        isCallbackCalled = false;
        if (timeout) {
          timeoutId = setTimeout(function() {
            var err;
            isCallbackCalled = true;
            err = new Error("migration timed-out");
            migrationDone({
              status: 'error',
              error: err
            });
            return allDone(err);
          }, timeout);
        }
        return fn.call(migrationContext, function(err) {
          if (isCallbackCalled) {
            return;
          }
          clearTimeout(timeoutId);
          if (err) {
            migrationDone({
              status: 'error',
              error: err
            });
            return allDone(err);
          } else {
            migrationDone({
              status: 'ok'
            });
            return runOne();
          }
        });
      };
      return runOne();
    };

    MigrationsRunner.prototype.runUp = function(migrations, done, progress) {
      return this._runWhenReady(migrations, 'up', done, progress);
    };

    MigrationsRunner.prototype.runDown = function(migrations, done, progress) {
      return this._runWhenReady(migrations, 'down', done, progress);
    };

    MigrationsRunner.prototype._runFromDir = function(dir, direction, done, progress) {
      return loadMigrationsFromDir(dir, (function(_this) {
        return function(err, migrations) {
          if (err) {
            return done(err);
          }
          migrations = _.map(migrations, 'module');
          if (direction === 'down') {
            migrations = migrations.reverse();
          }
          return _this._runWhenReady(migrations, direction, done, progress);
        };
      })(this));
    };

    MigrationsRunner.prototype.runUpFromDir = function(dir, done, progress) {
      return this._runFromDir(dir, 'up', done, progress);
    };

    MigrationsRunner.prototype.runDownFromDir = function(dir, done, progress) {
      return this._runFromDir(dir, 'down', done, progress);
    };

    MigrationsRunner.prototype._runSpecificFromDir = function(dir, migrationIds, direction, done, progress) {
      return loadSpecificMigrationsFromDir(dir, migrationIds, (function(_this) {
        return function(err, migrations) {
          if (err) {
            return done(err);
          }
          return _this._runWhenReady(migrations, direction, done, progress);
        };
      })(this));
    };

    MigrationsRunner.prototype.runSpecificUpFromDir = function(dir, migrationIds, done, progress) {
      return this._runSpecificFromDir(dir, migrationIds, 'up', done, progress);
    };

    MigrationsRunner.prototype.runSpecificDownFromDir = function(dir, migrationIds, done, progress) {
      return this._runSpecificFromDir(dir, migrationIds, 'down', done, progress);
    };

    MigrationsRunner.prototype.dispose = function(cb) {
      var onSuccess;
      this._isDisposed = true;
      onSuccess = (function(_this) {
        return function() {
          var e, error;
          try {
            _this._db.close();
            return typeof cb === "function" ? cb(null) : void 0;
          } catch (error) {
            e = error;
            return typeof cb === "function" ? cb(e) : void 0;
          }
        };
      })(this);
      return this._dbReady.then(onSuccess, cb);
    };

    return MigrationsRunner;

  })();

  module.exports.MigrationsRunner = MigrationsRunner;

}).call(this);
