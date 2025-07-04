declare module 'roslib' {
  export interface RosOptions {
    url: string;
  }

  export interface ServiceOptions {
    ros: Ros;
    name: string;
    serviceType: string;
  }

  export interface TopicOptions {
    ros: Ros;
    name: string;
    messageType: string;
    throttle_rate?: number;
    queue_length?: number;
  }

  export class Ros {
    constructor(options: RosOptions);
    on(event: 'connection' | 'error' | 'close', callback: (data?: any) => void): void;
    close(): void;
  }

  export class Service {
    constructor(options: ServiceOptions);
    callService(
      request: ServiceRequest, 
      callback: (result: any) => void, 
      errorCallback?: (error: any) => void
    ): void;
  }

  export class ServiceRequest {
    constructor(data?: any);
  }

  export class Topic {
    constructor(options: TopicOptions);
    subscribe(callback: (message: any) => void): void;
    unsubscribe(): void;
    publish(message: any): void;
  }

  export default {
    Ros,
    Service,
    ServiceRequest,
    Topic
  };
}