'use strict';

angular.module('app')

    .factory('SensorData', ['$http', '$timeout', '$interval', '$rootScope', '$location', '$q', 'APP_CONFIG', 'Notifications', 'Vehicles', 'Shipments',
        function ($http, $timeout, $interval, $rootScope, $location, $q, APP_CONFIG, Notifications, Vehicles, Shipments) {
        var factory = {},
            client = null,
            msgproto = null,
            listeners = [],
            topicRegex = /Red-Hat\/([^\/]*)\/iot-demo\/([^\/]*)\/([^\/]*)$/,
            alertRegex = /Red-Hat\/([^\/]*)\/iot-demo\/([^\/]*)\/([^\/]*)\/alerts$/,
            metricOverrides = {};

            // Set the name of the hidden property and the change event for visibility
            var hidden, visibilityChange;
            if (typeof document.hidden !== "undefined") { // Opera 12.10 and Firefox 18 and later support
                hidden = "hidden";
                visibilityChange = "visibilitychange";
            } else if (typeof document.msHidden !== "undefined") {
                hidden = "msHidden";
                visibilityChange = "msvisibilitychange";
            } else if (typeof document.webkitHidden !== "undefined") {
                hidden = "webkitHidden";
                visibilityChange = "webkitvisibilitychange";
            }

            // If the page/tab is hidden, pause the data stream;
            // if the page/tab is shown, restart the stream
            function handleVisibilityChange() {
                if (document[hidden]) {
                    listeners.forEach(function(listener) {
                        client.unsubscribe(listener.topic);
                    });
                } else {
                    // doc played
                    listeners.forEach(function(listener) {
                        client.subscribe(listener.topic);
                    });
                }
            }

            // Warn if the browser doesn't support addEventListener or the Page Visibility API
            if (typeof document.addEventListener === "undefined" || typeof document[hidden] === "undefined") {
                console.log("This demo requires a browser, such as Google Chrome or Firefox, that supports the Page Visibility API.");
            } else {
                // Handle page visibility change
                document.addEventListener(visibilityChange, handleVisibilityChange, false);
            }

        function onConnectionLost(responseObject) {
            if (responseObject.errorCode !== 0) {
                console.log("onConnectionLost:"+responseObject.errorMessage);
                Notifications.warn("Lost connection to broker, attempting to reconnect (" + responseObject.errorMessage);
                connectClient(1);

            }
        }

        function handleAlert(destination, alertPayload) {
            var matches = alertRegex.exec(destination);
            var objType = matches[2];
            var objId = matches[3];

            switch (objType) {
                case 'trucks':
                    $rootScope.$broadcast('vehicle:alert', {
                        vin: objId
                    });
                    break;
                case 'packages':
                    Shipments.getAllShipments(function(allShipments) {
                        allShipments.forEach(function(shipment) {
                            if (shipment.sensor_id == objId) {
                                $rootScope.$broadcast('package:alert', {
                                    vin: shipment.cur_vehicle.vin,
                                    sensor_id: objId
                                });
                            }
                        });
                    });
                    break;
                default:
                    console.log("ignoring alert: " + destination);
            }

        }

        function onMessageArrived(message) {
            var destination = message.destinationName;

            if (alertRegex.test(destination)) {
                handleAlert(destination, decoded);
            } else {
                var payload = message.payloadBytes;
                var decoded =  msgproto.decode(payload);
                var matches = topicRegex.exec(destination);
                var objType = matches[2];
                var objId = matches[3];

                listeners.filter(function(listener) {
                    return (listener.objType == objType && listener.objId == objId);
                }).forEach(function(listener) {
                    var targetObj = listener.pkg || listener.vehicle;
                    var cb = listener.listener;

                    var data = [];

                    decoded.metric.forEach(function(decodedMetric) {
                        targetObj.telemetry.forEach(function(objTel) {
                            var telName = objTel.name;
                            var telMetricName = objTel.metricName;
                            var value =  (metricOverrides[listener.objId] && metricOverrides[listener.objId][telMetricName]) ?
                                (metricOverrides[listener.objId][telMetricName] * (.95 + 0.05 * Math.random())).toFixed(1) :
                                decodedMetric.doubleValue.toFixed(1);
                            if (telMetricName == decodedMetric.name) {
                                data.push({
                                    name: telName,
                                    value: value,
                                    timestamp: new Date()
                                });
                            }
                        });
                    });
                    cb(data);
                });
            }
        }

        function onConnect() {
            console.log("Connected to server");
            var topicName = "Red-Hat/+/iot-demo/+/+/alerts";
            client.subscribe(topicName);

        }

        function connectClient(attempt) {

            var MAX_ATTEMPTS = 100;

            if (attempt > MAX_ATTEMPTS) {
                Notifications.error("Cannot connect to broker after " + MAX_ATTEMPTS +" attempts, reload to retry");
                return;
            }

            if (attempt > 1) {
                Notifications.warn("Trouble connecting to broker, will keep trying (reload to re-start the count)");
            }
            var brokerHostname = APP_CONFIG.BROKER_WEBSOCKET_HOSTNAME + '.' + $location.host().replace(/^.*?\.(.*)/g,"$1");
            client = new Paho.MQTT.Client(brokerHostname, Number(APP_CONFIG.BROKER_WEBSOCKET_PORT), "demo-client-" + guid());

            client.onConnectionLost = onConnectionLost;
            client.onMessageArrived = onMessageArrived;

            protobuf.load("kurapayload.proto", function(err, root) {
                if (err) throw err;

                msgproto = root.lookup("kuradatatypes.KuraPayload");
                // connect the client
                client.connect({
                    onSuccess: function() {
                        console.log("Connected to broker");
                        if (attempt > 1) {
                            Notifications.success("Connected to the IoT cloud!");
                        }
                        var topicName = "Red-Hat/+/iot-demo/+/+/alerts";
                        client.subscribe(topicName);
                    },
                    userName: APP_CONFIG.BROKER_USERNAME,
                    password: APP_CONFIG.BROKER_PASSWORD,
                    onFailure: function(err) {
                        console.log("Failed to connect to broker (attempt " + attempt + "), retrying. Error code:" + err.errorCode + " message:" + err.errorMessage);
                        $timeout(function() {
                            connectClient(attempt+1);
                        }, 10000);
                    }
                });
            });
        }

        function guid() {
            function s4() {
                return Math.floor((1 + Math.random()) * 0x10000)
                    .toString(16)
                    .substring(1);
            }
            return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
                s4() + '-' + s4() + s4() + s4();
        }

        factory.subscribePkg = function (pkg, listener) {

            var topicName = "Red-Hat/+/iot-demo/packages/" + pkg.sensor_id;
            client.subscribe(topicName);
            console.log("subscribed to " + topicName);
            listeners.push({
                pkg: pkg,
                topic: topicName,
                objType: 'packages',
                objId: pkg.sensor_id,
                listener: listener
            });
        };

        factory.subscribeVehicle = function (vehicle, listener) {

            var topicName = "Red-Hat/+/iot-demo/trucks/" + vehicle.vin;
            client.subscribe(topicName);
            console.log("subscribed to " + topicName);
            listeners.push({
                vehicle: vehicle,
                topic: topicName,
                objType: 'trucks',
                objId: vehicle.vin,
                listener: listener
            });
        };

        factory.unsubscribeVehicle = function (vehicle) {
            var topicName = "Red-Hat/+/iot-demo/trucks/" + vehicle.vin;
            client.unsubscribe(topicName);
            console.log("UNsubscribed to " + topicName);
            listeners = listeners.filter(function(listener) {
                return ((!listener.vehicle) || (listener.vehicle.vin != vehicle.vin));
            });
        };

        factory.unsubscribePackage = function (pkg) {
            var topicName = "Red-Hat/+/iot-demo/packages/" + pkg.sensor_id;
            client.unsubscribe(topicName);
            console.log("UNsubscribed to " + topicName);
            listeners = listeners.filter(function(listener) {
                return ((!listener.pkg)  || (listener.pkg.sensor_id != pkg.sensor_id));
            });
        };


        factory.unsubscribeAll = function () {
            listeners.forEach(function(listener) {
               client.unsubscribe(listener.topic);
            });

            listeners = [];
        };

        factory.getRecentData = function (pkg, telemetry, cb) {

            var esUrl = "http://" + APP_CONFIG.ES_HOSTNAME + '.' +
                $location.host().replace(/^.*?\.(.*)/g,"$1") + ':' + APP_CONFIG.ES_PORT + '/_search';

            $http({
                method: 'POST',
                url: esUrl,
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                data: {
                    "size": 0,
                    "query": {
                        "bool": {
                          "must": [
                            {
                              "term": {
                                "channel": "iot-demo/packages/" + pkg.sensor_id
                              }
                            }
                          ]
                        }
                    },
                    "aggs": {
                        "my_date_histo": {
                            "date_histogram": {
                                "field": "timestamp",
                                "interval": "5m"
                            },
                            "aggs": {
                                "the_avg": {
                                    "avg": {
                                        "field": "metrics." + telemetry.metricName + ".dbl"
                                    }
                                },
                                "the_movavg": {
                                    "moving_avg": {
                                        "buckets_path": "the_avg"
                                    }
                                }
                            }
                        }
                    }
                }
            }).then(function successCallback(response) {

                if (!response.data) {
                    cb([]);
                    return;
                }

                var recentData = [];
                response.data.aggregations.my_date_histo.buckets.forEach(function (bucket) {
                    if (bucket.the_movavg) {
                        recentData.push({
                            timestamp: bucket.key,
                            value: bucket.the_movavg.value
                        });
                    }
                });
                cb(recentData);
            }, function errorCallback(response) {
                Notifications.error("error fetching recent data: " + response.statusText);
            });


        };

        function sendMsg(obj, topic) {
            var payload = msgproto.encode(obj).finish();

            var message = new Paho.MQTT.Message(payload);
            message.destinationName = topic;
            client.send(message);
        }

        factory.cascadingAlert = function(vehicle) {

            var hitemp =
                {
                    timestamp: new Date().getTime(),
                    metric: [
                        {
                            name: 'temp',
                            type: 'DOUBLE',
                            doubleValue: 265
                        }
                    ]
                };
            var hipkgtemp =
                {
                    timestamp: new Date().getTime(),
                    metric: [
                        {
                            name: 'Ambient',
                            type: 'DOUBLE',
                            doubleValue: 42.2
                        }
                    ]
                };

            var hipress =
                {
                    timestamp: new Date().getTime(),
                    metric: [
                        {
                            name: 'oilpress',
                            type: 'DOUBLE',
                            doubleValue: 95
                        }
                    ]
                };

            metricOverrides[vehicle.vin] = {};
            $interval(function() {
                metricOverrides[vehicle.vin]['temp'] = 265;
                sendMsg(hitemp, 'Red-Hat/sim-truck/iot-demo/trucks/' + vehicle.vin)
            }, 5000);

            $timeout(function() {
                metricOverrides[vehicle.vin]['oilpress'] = 95;
                $interval(function() {
                    sendMsg(hipress, 'Red-Hat/sim-truck/iot-demo/trucks/' + vehicle.vin);
                    // for (var i = 1; i <= 20; i++) {
                    //     sendMsg(hipkgtemp, 'Red-Hat/sim-truck/iot-demo/packages/pkg-' + i);
                    //     metricOverrides['pkg-' + i] = {};
                    //     metricOverrides['pkg-' + i]['Ambient'] = 42.2;
                    // }
                }, 5000);
            }, 15000);


            $timeout(function() {
                sendMsg(hitemp, 'Red-Hat/sim-truck/iot-demo/trucks/' + vehicle.vin + '/alerts');
                // ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'].forEach(function(el, idx) {
                //     $timeout(function() {
                //         sendMsg(hipkgtemp, 'Red-Hat/sim-truck/iot-demo/packages/pkg-' + el + '/alerts');
                //     }, idx * 500);
                // });

            }, 25000);

        };

            factory.cascadingPkgAlert = function(pkg) {

                var hipkgtemp =
                    {
                        timestamp: new Date().getTime(),
                        metric: [
                            {
                                name: 'Ambient',
                                type: 'DOUBLE',
                                doubleValue: 42.2
                            }
                        ]
                    };

                $timeout(function() {
                    $interval(function() {
                        for (var i = 1; i <= 20; i++) {
                            sendMsg(hipkgtemp, 'Red-Hat/sim-truck/iot-demo/packages/pkg-' + i);
                            metricOverrides['pkg-' + i] = {};
                            metricOverrides['pkg-' + i]['Ambient'] = 42.2;
                        }
                    }, 5000);
                }, 5000);


                $timeout(function() {
                    // sendMsg(hitemp, 'Red-Hat/sim-truck/iot-demo/trucks/' + vehicle.vin + '/alerts');
                    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'].forEach(function(el, idx) {
                        $timeout(function() {
                            sendMsg(hipkgtemp, 'Red-Hat/sim-truck/iot-demo/packages/pkg-' + el + '/alerts');
                        }, idx * 500);
                    });

                }, 15000);

            };

            connectClient(1);
        return factory;
    }]);
