'use strict';
const fs         = require('fs');
const path       = require('path');
const yaml       = require('yamljs');
const winston    = require('winston');
const Flow       = require('./lib/flow').Flow;
const context    = require('./lib/context');

//TODO: create a logger for each flow instance
const logger     = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)(
            {'timestamp': true, 'colorize': true, level: 'debug'})
    ]
});

//The middleware ctor function. The configuration is setup via the options.
//
//The options object may have:
//  - flow: the YAML file path
//  - basedir: the working directory, for loading the other files.
//  - tasks: the custom policies to be executed, usually they are pieces of
//           javascript code.
module.exports = function(options) {
    var config;
    var error;
    //used to interpret or resolve the place holder in the config properties
    var paramResolver;
    //store the tasks's setup functions
    var tasks;
    var ctx;

    //step 1: loading the assembly yaml
    try {
        //read assembly file. TODO: this will be replaced by mplane later on
        logger.debug('Loading the assembly file "%s"', options.flow);
        config = yaml.load(options.flow);

        //watch the assembly file
        fs.watchFile(options.flow, function (curr, prev) {
            //if file changes, reload it
            if ( curr.mtime > prev.mtime ) {
                logger.info('The assembly file is changed. ' +
                    'Reload the file for the following requests.');
                try {
                    config = yaml.load(options.flow);
                    error = undefined;
                }
                catch (e2) {
                    logger.error('Failed to reload the assembly file: %s', e2);
                    error = e2;
                }
            }
        });
    } catch (e) {
        logger.error('Failed to load the assembly file: %s', e);
        error = e;
    }

    //step 2: loading the paramResolver if the 'paramResolver' presents
    try {
        // the callback function for resolving task's parameter values
        // TODO fix the issue of using '.' with path.join('.', 'someModule');
        //      Verify the test using mocha test case in test-flow.js
        // TODO paramResolver & task's base path must be the same???
        if (options.paramResolver) {
            logger.debug('Loading the parameter resolver "%s"',
                    options.paramResolver);
            paramResolver = require(
                    path.join((options.baseDir ? options.baseDir : '') ,
                    options.paramResolver))();
        }
    } catch (e) {
        logger.error('Failed to load the parameter resolver: %s', e);
        logger.info('Continue the flow execution without a parameter resolver');
    }

    //step 3: loading tasks module if there is
    tasks = loadTasks(options.tasks, options.baseDir);

    //step 4: prepare ctx if not ready
    ctx = options.context || context.createContext();

    //return the middleware function
    return function (req, res, next) {
        if ( error ) {
            logger.info('Go to the error middleware');

            //error with loading the assembly file. Go to the error middleware
            next(error);
        }
        else {
            logger.info('Invoke the Flow middleware');

            //start to run the flow engine
            var flow = new Flow(config,
                    { 'paramResolver': paramResolver,
                      'baseDir': options.baseDir,
                      'tasks': tasks,
                    });

            //create the empty message on the context
            ctx.set('message', {}, true);

            //execute the flow with the Context object.
            flow.prepare(ctx, next);
            flow.run();
        }
    };
};

function loadTasks(tasks, baseDir) {
    var rev = {};
    baseDir = baseDir || '';
    for (let name in tasks) {
        try {
            logger.debug('Loading the custom policy "%s"', name);
            // TODO fix the issue of using '.' with path.join('.', 'someModule')
            //      Verify the test using mocha test case in test-flow.js
            let taskFunc = require(path.join(baseDir, tasks[name]));
            if ( !(taskFunc instanceof Function) ) {
                logger.error('The "%s" policy is not a function. Skip it.',
                        name);
                continue;
            }
            rev[name] = taskFunc({});
        } catch (e) {
            logger.error('Failed to load the custom policy "%s": %s', name, e);
        }
    }
    return rev;
}

module.exports.Flow = Flow;
module.exports.createContext = context.createContext;
