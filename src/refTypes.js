'use strict';
import maybeThenable from './maybeThenable';
import { PENDING, RESOLVED, FULFILLED, REJECTED, HANDLED } from './state';

export function isPending(ref) {
    return (ref.state() & PENDING) > 0;
}

export function isFulfilled(ref) {
    return (ref.state() & FULFILLED) > 0;
}

export function isRejected(ref) {
    return (ref.state() & REJECTED) > 0;
}

export function isSettled(ref) {
    return isFulfilled(ref) || isRejected(ref);
}

export function getValue(ref) {
    if(!isFulfilled(ref)) {
        throw new TypeError('not fulfilled');
    }

    return ref.join().value;
}

export function getReason(ref) {
    if(!isRejected(ref)) {
        throw new TypeError('not rejected');
    }

    return ref.join().value;
}

export function makeRefTypes(isPromise, handlerForPromise, trackError, taskQueue) {

    class Deferred {
        constructor() {
            this.handler = void 0;
            this.action = void 0;
            this.length = 0;
            this._state = PENDING;
        }

        state() {
            return this.isResolved() ? this.handler.join().state() : this._state;
        }

        when(action) {
            this.asap(action);
        }

        asap(action) {
            if (this.isResolved(this)) {
                this.join().when(action);
            } else if(this.length === 0) {
                this.action = action;
                this.length++;
            } else {
                this[this.length++] = action;
            }
        }

        join() {
            if (!this.isResolved()) {
                return this;
            }

            return this.handler = (this.handler === this ? cycle() : this.handler.join());
        }

        become(handler) {
            if(this.isResolved()) {
                return;
            }

            this._state |= RESOLVED;
            this.handler = handler;
            if(this.length > 0) {
                taskQueue.enqueue(this);
            }
        }

        isResolved() {
            return (this._state & RESOLVED) > 0;
        }

        resolve(x) {
            this.become(handlerFor(x));
        }

        fulfill(x) {
            this.become(new Fulfilled(x));
        }

        reject(e) {
            if(this.isResolved()) {
                return;
            }

            this.become(new Rejected(e));
        }

        run() {
            let handler = this.handler.join();
            handler.asap(this.action);

            for (let i = 1, l = this.length; i < l; ++i) {
                handler.asap(this[i]);
                this[i] = void 0;
            }
        }
    }

    class Fulfilled {
        constructor(x) {
            this.value = x;
        }

        state() {
            return FULFILLED;
        }

        asap(action) {
            return action.fulfilled(this);
        }

        when(action) {
            taskQueue.enqueue(new Continuation(action, this));
        }

        join() {
            return this;
        }
    }

    class Rejected {
        constructor(e) {
            this.value = e;
            this._state = REJECTED;
            trackError(this);
        }

        state() {
            return this._state;
        }

        asap(action) {
            if(action.rejected(this)) {
                this._state |= HANDLED;
            }
        }

        when(action) {
            taskQueue.enqueue(new Continuation(action, this));
        }

        join() {
            return this;
        }
    }

    class Never {
        state() {
            return PENDING;
        }

        asap() {}

        when() {}

        join() {
            return this;
        }
    }

    function extract(then, thenable) {
        let d = new Deferred();
        taskQueue.enqueue(new Assimilate(then, thenable, x => d.resolve(x), e => d.reject(e)));
        return d;
    }

    class Assimilate {
        constructor(then, thenable, resolve, reject) {
            this._then = then;
            this.thenable = thenable;
            this.resolve = resolve;
            this.reject = reject;
        }

        run() {
            try {
                this._then.call(this.thenable, this.resolve, this.reject);
            } catch (e) {
                this.reject(e);
            }
        }
    }

    return {
        handlerFor, handlerForNonPromise, handlerForMaybeThenable,
        Deferred, Fulfilled, Rejected, Never
    };

    function handlerFor(x) {
        return isPromise(x) ? handlerForPromise(x).join() : handlerForNonPromise(x);
    }

    function handlerForNonPromise(x) {
        return maybeThenable(x) ? handleForUntrusted(x) : new Fulfilled(x);
    }

    function handlerForMaybeThenable(x) {
        return isPromise(x) ? handlerForPromise(x).join() : handleForUntrusted(x);
    }

    function handleForUntrusted(x) {
        try {
            let then = x.then;
            return typeof then === 'function' ? extract(then, x) : new Fulfilled(x);
        } catch(e) {
            return new Rejected(e);
        }
    }

    function cycle() {
        return new Rejected(new TypeError('resolution cycle'));
    }
}

class Continuation {
    constructor(action, handler) {
        this.action = action;
        this.handler = handler;
    }

    run() {
        this.handler.join().asap(this.action);
    }
}