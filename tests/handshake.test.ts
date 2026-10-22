import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { host, guest } from "../src/index";
import * as helpers from "../src/helpers";
import { EventEmitter } from "events";

class MockPort extends EventEmitter {
  partner?: MockPort;
  postMessage(message: any) {
    this.partner?.emit("message", message);
  }
  terminate() {}
}

let addEventListenerSpy: any;
let removeEventListenerSpy: any;
let postMessageSpy: any;
let generateIdSpy: any;
let getTargetHostSpy: any;
let originalSelf: any;

beforeEach(() => {
  originalSelf = global.self;
  addEventListenerSpy = vi
    .spyOn(helpers, "addEventListener")
    .mockImplementation((target: any, _event: string, handler: any) => {
      target.on("message", handler);
    });
  removeEventListenerSpy = vi
    .spyOn(helpers, "removeEventListener")
    .mockImplementation((target: any, _event: string, handler: any) => {
      target.off("message", handler);
    });
  postMessageSpy = vi
    .spyOn(helpers, "postMessageToTarget")
    .mockImplementation((target: any, message: any) => {
      target.postMessage(message);
    });
  let counter = 1;
  generateIdSpy = vi
    .spyOn(helpers, "generateId")
    .mockImplementation(() => `id-${counter++}`);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalSelf === undefined) {
    delete global.self;
  } else {
    global.self = originalSelf;
  }
});

function setupPorts() {
  const port1 = new MockPort();
  const port2 = new MockPort();
  port1.partner = port2;
  port2.partner = port1;
  return { port1, port2 };
}

describe("handshake with rpc", () => {
  it("allows calling exposed methods after handshake", async () => {
    const { port1, port2 } = setupPorts();
    getTargetHostSpy = vi.spyOn(helpers, "getTargetHost").mockReturnValue(port1);
    // @ts-expect-error - mock worker self
    global.self = port1;

    const hostPromise = host.connect(port2, {
      add: (a: number, b: number) => a + b,
    });
    const guestPromise = guest.connect({});

    const guestConn = await guestPromise;
    const hostConn = await hostPromise;

    const result = await guestConn.remote.add(2, 3);
    expect(result).toBe(5);

    hostConn.close();
    guestConn.close();
  });

  it("supports using the remote parameter inside RPC handlers", async () => {
    const { port1, port2 } = setupPorts();
    getTargetHostSpy = vi.spyOn(helpers, "getTargetHost").mockReturnValue(port1);
    // @ts-expect-error - mock worker self
    global.self = port1;

    const hostSchema = {
      send: async (msg: string, remote: any) => {
        const res = await remote.reply(`ACK ${msg}`);
        return res;
      },
    };
    const guestSchema = {
      reply: (text: string) => `${text}!`,
    };

    const hostPromise = host.connect(port2, hostSchema);
    const guestPromise = guest.connect(guestSchema);

    const guestConn = await guestPromise;
    const hostConn = await hostPromise;

    const result = await guestConn.remote.send("ping");
    expect(result).toBe("ACK ping!");

    hostConn.close();
    guestConn.close();
  });

  it("removes the response listener once an RPC call resolves", async () => {
    const { port1, port2 } = setupPorts();
    getTargetHostSpy = vi.spyOn(helpers, "getTargetHost").mockReturnValue(port1);
    // @ts-expect-error - mock worker self
    global.self = port1;

    const hostPromise = host.connect(port2, {
      add: (a: number, b: number) => a + b,
    });
    const guestConn = await guest.connect({});
    const hostConn = await hostPromise;
    const listenerCount = port1.listenerCount("message");

    await guestConn.remote.add(1, 2);
    await Promise.all([guestConn.remote.add(3, 4), guestConn.remote.add(5, 6)]);
    const leakedListeners = port1.listenerCount("message") - listenerCount;

    hostConn.close();
    guestConn.close();

    expect(leakedListeners).toBe(0);
  });

  it("removes the response listener once an RPC call rejects", async () => {
    const { port1, port2 } = setupPorts();
    getTargetHostSpy = vi.spyOn(helpers, "getTargetHost").mockReturnValue(port1);
    // @ts-expect-error - mock worker self
    global.self = port1;

    const hostPromise = host.connect(port2, {
      fail: () => {
        throw new Error("nope");
      },
    });
    const guestConn = await guest.connect({});
    const hostConn = await hostPromise;
    const listenerCount = port1.listenerCount("message");

    await expect(guestConn.remote.fail()).rejects.toMatchObject({ message: "nope" });
    const leakedListeners = port1.listenerCount("message") - listenerCount;

    hostConn.close();
    guestConn.close();

    expect(leakedListeners).toBe(0);
  });

  it("removes the listeners of pending RPC calls when the connection closes", async () => {
    const { port1, port2 } = setupPorts();
    getTargetHostSpy = vi.spyOn(helpers, "getTargetHost").mockReturnValue(port1);
    // @ts-expect-error - mock worker self
    global.self = port1;

    const hostPromise = host.connect(port2, {
      wait: () => new Promise(() => {}),
    });
    const guestConn = await guest.connect({});
    const hostConn = await hostPromise;

    guestConn.remote.wait();
    guestConn.remote.wait();
    guestConn.remote.wait();
    guestConn.close();
    hostConn.close();

    expect(port1.listenerCount("message")).toBe(0);
  });
});
