/* eslint-disable @typescript-eslint/no-use-before-define */
"use strict";

if (!window.AWSPanorama) {
    window.AWSPanorama = {};
}

AWSPanorama.Init = (function () {
    var PUBLIC_LOG_ENDPOINT = ".prod.pr.analytics.console.aws.a2z.com",
        CN_LOG_ENDPOINT = ".prod.pr.uis.console.aws.a2z.org.cn",
        DEFAULT_CONSOLE_REGION = "us-east-1",
        DEFAULT_NONCONSOLE_REGION = "us-west-1",
        MODALITY = "web",
        PANORAMA = "panorama",
        PROD_DOMAIN = "aws.amazon.com",
        ALPHA_DOC_DOMAIN = "alpha-docs-aws.amazon.com",
        defaultTrackerConstants = {
            cookieDomain: "aws.amazon.com",
            pluginsEnabledByDefault: true,
            modality: MODALITY,
        },
        FEDERATED_USER_STRING = ":federated-user/assumed-role/",
        TANGERINEBOX_USER_STRING = ":assumed-role/",
        ISENGARD_STRING = "-Isengard",
        CONDUIT_STRING = "Conduit",
        denyListedServices = [], // add services to ignore here
        denyListedDomains = [
            "aws-billingconsole-ro.aws-border.cn",
            "aws-ciw-readonly.amazon.com",
            "aws-bpc-readonly-midway.corp.amazon.com",
        ], // add list of domains for denylisting
        experimentalServices = [], // add services to test on in this array
        internalAccountTargetPartitions = [], //add new partitions in this array for which you want to deploy tracker for internal accounts only!!
        externalDefaultTrackerUrl =
            // eslint-disable-next-line max-len
            "https://a.b.cdn.console.awsstatic.com/a/v1/FR6V6EBWG3NJEGXIO6VIRRIDLM2NUOSB2MPREQYEBDQZUIP4WWMQ/41645f3fc3da44f792c75fbf27fb169c08af0aad7020416b8c07dba4c224fc77.js", // 2.8.101
        experimentalTrackerUrl =
            // eslint-disable-next-line max-len
            "https://a.b.cdn.console.awsstatic.com/eceaafcb1984b61acf911f7e759bb53aba4dee16828022094a43b59ef4524def/79553d5bc938487484a29f13943002a9e75a2fc43349421f9faf06046d189a9a.js", // 2.8.25 - Speed Index
        hostName = window.location.hostname,
        isProd = hostName.includes(PROD_DOMAIN) && !hostName.includes(ALPHA_DOC_DOMAIN), // determine if the environment is a Prod AWS property but not of Docs Alpha site
        windowAlias = window,
        log = function (...params) {
            if (windowAlias.AWSC && windowAlias.AWSC.Clog && windowAlias.AWSC.Clog.log) {
                return windowAlias.AWSC.Clog.log(...params);
            }
            return undefined;
        };

    log("panoInitStart", 1);

    // Exit out early if Panorama is disabled on the page
    if (windowAlias.disablePanorama) {
        log("panoInitPanoramaDisabled", 1);

        return;
    }

    /**
     * Utility function to check if we are within the AWS Console
     * @returns {boolean} indicating whether this is the console or not
     */
    var isAwsConsole = (function () {
        if (windowAlias.ConsoleNavService || getContentAttrFromMetaTag("awsc-mezz") !== null) {
            return true;
        }

        return false;
    })();

    /**
     * Extracts cookie value by name
     */
    var getCookieByName = function (name) {
        try {
            var cookie = document.cookie.split("; ").find((cookie) => cookie.split("=")[0] === name);
            return cookie ? cookie.split("=")[1] : "";
        } catch (e) {
            return "";
        }
    };

    /**
     *  Function to get the partition name based on the console region
     *  @param region {string} - the current Console region
     *  @returns the partition name for a given region
     * */
    function getPartitionForRegion(region) {
        var awsPartitionName = {
            Aws: "aws",
            AwsUsGov: "aws-us-gov",
            AwsIso: "aws-iso",
            AwsIsoB: "aws-iso-b",
            AwsCn: "aws-cn",
        };

        if (region.startsWith("us-gov-")) {
            return awsPartitionName.AwsUsGov;
        } else if (region.startsWith("us-iso-")) {
            return awsPartitionName.AwsIso;
        } else if (region.startsWith("us-isob-")) {
            return awsPartitionName.AwsIsoB;
        } else if (region.startsWith("cn-")) {
            return awsPartitionName.AwsCn;
        }

        return awsPartitionName.Aws;
    }

    // returns a map of cookies
    function parseCookie(str) {
        var cookieMap = str
            .split(";")
            .map((v) => v.split("="))
            .reduce((acc, v) => {
                acc[decodeURIComponent(v[0].trim())] = decodeURIComponent(v[1].trim());
                return acc;
            }, {});
        return cookieMap;
    }

    /*
     * Validates if a given userArn belongs to an Isengard account
     * */
    function isIsengard(roleName) {
        if (
            roleName.endsWith(ISENGARD_STRING) &&
            (roleName.includes(FEDERATED_USER_STRING) || roleName.includes(TANGERINEBOX_USER_STRING))
        ) {
            return true;
        }
        return false;
    }

    /*
     * Validates if a given userArn belongs to an Conduit account
     * */
    function isConduit(roleName) {
        if (roleName.includes(CONDUIT_STRING)) {
            return true;
        }
        return false;
    }

    /*
     *Validates if a given userArn belongs to an internal account
     * */
    function isInternalAccount(cookie) {
        try {
            var roleName = JSON.parse(parseCookie(document.cookie)[cookie]).arn;
            if (isIsengard(roleName) || isConduit(roleName)) {
                return true;
            }
        } catch (e) {
            console.warn("Panorama:", e);
            return false;
        }
        return false;
    }

    /*
     * enables tracker rollout plan for internal accounts only when deploying in a new partition.
     **/
    function isTrackerRolloutPlanEnabledForTargetPartitions(currentPartition) {
        if (internalAccountTargetPartitions.indexOf(currentPartition) >= 0 && !isInternalAccount("aws-userInfo")) {
            return true;
        }
        return false;
    }

    if (isAwsConsole) {
        log("panoInitAwsConsole", 1);

        try {
            // if the ConsoleNavService object is available, proceed with tracker initialization
            if (windowAlias.ConsoleNavService && windowAlias.ConsoleNavService.Model) {
                var metaTagRegion = getContentAttrFromMetaTag("awsc-mezz-region");
                var metaTagService = getContentAttrFromMetaTag("awsc-mezz-service");
                var region = metaTagRegion || DEFAULT_CONSOLE_REGION,
                    service = windowAlias.ConsoleNavService.Model.currentService.id || metaTagService;
                // Commercial regions where Panorama is not yet ready to be enabled
                // List of AWS regions to be excluded - ZAZ, MEL, HYD, ZRH, TLV
                var excludedAWSRegions = ["us-northeast-1", "ca-west-1"];
                var currentPartition = getPartitionForRegion(region);
                // List of supported AWS partitions
                var supportedPartitions = ["aws", "aws-cn", "aws-us-gov"];
                // Only run rest of the code if on the supported partition, or if the current service does not match a deny-listed service, or if current host domain is supported, or if we are on a PhantomJS browser; this logic replaces the NavFAC checks
                if (
                    !supportedPartitions.includes(currentPartition) ||
                    excludedAWSRegions.indexOf(region) >= 0 ||
                    denyListedServices.indexOf(service) >= 0 ||
                    denyListedDomains.includes(hostName) ||
                    !!windowAlias.callPhantom ||
                    isTrackerRolloutPlanEnabledForTargetPartitions(currentPartition)
                ) {
                    log(
                        "panoInitUnsupported",
                        1,
                        [
                            "currentPartition: " + currentPartition,
                            "region: " + region,
                            "service: " + service,
                            "hostName: " + hostName,
                        ].join(", ")
                    );

                    return;
                }

                var trackerConfig = {
                    appEntity: "aws-console",
                    console: true,
                    region: region,
                    service,
                    trackerConstants: defaultTrackerConstants,
                };

                initializePanoramaTracker(
                    region,
                    windowAlias,
                    document,
                    "script",
                    getTrackerUrl(service, true),
                    PANORAMA,
                    null,
                    null,
                    trackerConfig
                );
            } else {
                log("panoInitNoConsoleNavService", 1);
            }
        } catch (e) {
            log("panoInitAwsConsoleLoadError", 1, "error: " + e.message);

            console.warn("Panorama:", e);
        }
    } else {
        log("panoInitNotAwsConsole", 1);

        try {
            var scriptTag = document.getElementById("awsc-panorama-bundle");
            var trackerConfiguration;
            // Excluding AWS Sign In from rate limit as they are handling loading tracker on their side
            var ignoreTrackerRateLimit = ["aws-signin"];
            // Config to have dynamic load rate for different app entity
            var trackerLoadRateConfig = {
                "aws-documentation": 1, // 100%
                "aws-marketing": 1, // 100%
                default: 1, // 100%
            };
            // Check if it is a canary traffic
            var isCanaryTraffic = getCookieByName("metrics-req-cat") === "canary";
            // List of app entities where we want to randomize region selection for scaling needs
            var appEntityForRandomizedRegions = ["aws-marketing"];
            // List of regions to consider for scaling needs
            var regionsToConsider = ["us-east-2","us-west-1","eu-west-2"];

            /**
             * Checks if current session is eligible for tracker rate limit based on App Entity value and return the load rate value
             */
            var getTrackerLoadRate = function (appEntity) {
                try {
                    var eligibleForTrackerLoadRate =
                        isProd && !ignoreTrackerRateLimit.includes(appEntity) && !isCanaryTraffic;
                    if (eligibleForTrackerLoadRate) {
                        return trackerLoadRateConfig[appEntity] || trackerLoadRateConfig.default;
                    }
                    return 1;
                } catch (e) {
                    return 1;
                }
            };

            if (scriptTag && scriptTag.hasAttribute("data-config")) {
                var dataConfig = scriptTag.getAttribute("data-config");

                var parsedConfiguration;
                try {
                    parsedConfiguration = JSON.parse(dataConfig);
                } catch (e) {
                    // AWS Documentation is using XML format to inject scripts
                    // To make script tag XML complaint, double quotes inside data-config was changed to single quotes
                    // which is breaking JSON.parse
                    // Adding logic to convert single quotes back to double quotes and parse
                    dataConfig = dataConfig.replace(/'/g, '"');
                    parsedConfiguration = JSON.parse(dataConfig);
                }

                var appEntity = parsedConfiguration.appEntity ? parsedConfiguration.appEntity : "",
                    serviceId = parsedConfiguration.service ? parsedConfiguration.service : "",
                    regionCode = parsedConfiguration.region ? parsedConfiguration.region : "",
                    flags = parsedConfiguration.flags ? parsedConfiguration.flags : {},
                    domain = parsedConfiguration.domain ? parsedConfiguration.domain : "",
                    parsedTrackerConstants = parsedConfiguration.trackerConstants ? parsedConfiguration.trackerConstants : {},
                    trackerLoadRate = getTrackerLoadRate(appEntity); // knob to control how many customers can load the tracker script. Value should be between 0 and 1. Starting off with 0.1 (10% traffic) for Prod and 1 (100% traffic) for PreProd.

                // For app entities like AWS Marketing, traffic is too high and our backend stacks are regional.
                // We need to scale individual regions to handle traffic as there is no LBR endpoint on the routing side
                // To reduce the load on our routing stack, adding a logic in tracker to randomize the region selection to send data to
                // We will randomly pick region from 3 available one and send traffic to them on each page load
                try {
                    if (appEntityForRandomizedRegions.includes(appEntity)) {
                        var randomizerIndex = (Math.floor(Math.random() * regionsToConsider.length));
                        regionCode = regionsToConsider[randomizerIndex];
                    }
                } catch (err) {
                    log("panoramaRegionRandomizerError", 1);
                }

                // exit out if service ID, region, or appEntity are unavailable or if the service is denylisted
                if (!serviceId || !regionCode || !appEntity || denyListedServices.indexOf(serviceId) >= 0) {
                    log(
                        "panoInitUnavailableResourceData",
                        1,
                        ["serviceId: " + serviceId, "regionCode: " + regionCode, "appEntity: " + appEntity].join(", ")
                    );

                    console.warn(
                        // eslint-disable-next-line max-len
                        "Panorama could not be loaded. This could be due to incorrect configuration or because the service is denylisted."
                    );
                    return;
                }

                // Only load the tracker for a set percentage of users. By default, all users will load the tracker
                if (Math.random() > trackerLoadRate) {
                    log("panoInitAboveTrackerLoadRate", 1, "trackerLoadRate: " + trackerLoadRate);

                    return;
                }

                trackerConfiguration = {
                    appEntity: parsedConfiguration.appEntity,
                    console: false,
                    region: parsedConfiguration.region,
                    service: parsedConfiguration.service,
                    domain: parsedConfiguration.domain,
                    trackerConstants: {
                        ...defaultTrackerConstants,
                        ...parsedTrackerConstants,
                        flags,
                    },
                };
            }

            var defaultConfig = {
                appEntity: "aws-nonconsole",
                console: false,
                region: DEFAULT_NONCONSOLE_REGION,
                service: "non-console", // placeholder service ID if none is provided
                trackerConstants: defaultTrackerConstants,
            };

            initializePanoramaTracker(
                regionCode || defaultConfig.region,
                windowAlias,
                document,
                "script",
                getTrackerUrl(serviceId || defaultConfig.service, false),
                PANORAMA,
                null,
                null,
                trackerConfiguration || defaultConfig
            );
        } catch (e) {
            log("panoInitNotAwsConsoleLoadError", 1, "error" + e.message);

            console.warn("Panorama:", e);
        }
    }

    /**
     * Utility function to provide the tracker URL to be used for the given service
     * @param {string} id - service ID
     * @param {boolean} isAwsConsole - is this an AWS console?
     * @returns the tracker URL corresponding to the service if there is an experimental URL or the default console URL; else, returns the default Shared CDN URL
     */
    // eslint-disable-next-line no-shadow
    function getTrackerUrl(id, isAwsConsole) {
        try {
            if (experimentalServices.indexOf(id) >= 0) {
                return experimentalTrackerUrl;
            }

            // Extract tracker CDN endpoint from data-url attr on the script tag.
            var trackerCdnUrlFromDataset = document.getElementById("awsc-panorama-bundle").getAttribute("data-url");

            if (isAwsConsole) {
                return trackerCdnUrlFromDataset;
            }

            // if tracker endpoint present in the data-url attr, use it else use the one in the init script.
            return trackerCdnUrlFromDataset || externalDefaultTrackerUrl;
        } catch (e) {
            console.warn("Panorama: No tracker URL found.");
        }
    }

    /**
     * Utility function to emit a custom event upon panorama load success or failure
     * @param isEnabled flag to emit with the custom event
     */
    function dispatchPanoramaLoadEvent(isEnabled) {
        try {
            var panoramaLoadEvent = document.createEvent("CustomEvent");
            panoramaLoadEvent.initCustomEvent("onPanoramaLoad", true, true, {
                enabled: isEnabled,
            });
            windowAlias.dispatchEvent(panoramaLoadEvent);

            if (!isEnabled) {
                windowAlias.panorama = function () {
                    console.warn("Panorama is not enabled; events will not be emitted.");
                    return undefined;
                };
                windowAlias.panorama.enabled = false;

                if (isAwsConsole) {
                    windowAlias.AWSC.Clog.bufferedQueue = [];
                }
            }
        } catch (e) {
            log("dispatchPanoramaLoadError", 1);
        }
    }

    /**
     * Gets the "content" attribute's value from meta tags with a specific name
     * @param {string} metaTagName - the "name" to look for in the document's meta tag
     * @returns the attribute value or null if none is not found
     */
    function getContentAttrFromMetaTag(metaTagName) {
        try {
            return document.head.querySelector("meta[name='" + metaTagName + "']").getAttribute("content");
        } catch (e) {
            return null;
        }
    }

    /**
     * Returns log endpoint to be used
     * @param {string} region
     * @returns {string}
     */
    function getLogEndpoint(region) {
        var partition = getPartitionForRegion(region);
        var logEndpoint = PUBLIC_LOG_ENDPOINT;
        switch (partition) {
            case "aws-cn":
                logEndpoint = CN_LOG_ENDPOINT;
                break;
            case "aws-us-gov":
                logEndpoint = PUBLIC_LOG_ENDPOINT;
                break;
            default:
                logEndpoint = PUBLIC_LOG_ENDPOINT;
                break;
        }
        return logEndpoint;
    }

    /**
     * This function is to load Panorama Tracker script.
     *
     * @param r Current region from ConsoleNavService
     * @param p The window
     * @param l The document
     * @param o "script", the tag name of script elements
     * @param w The source of the Panorama script. Make sure you get the latest version.
     * @param i The Panorama namespace. The Panorama user should set this.
     * @param n The new script (to be created inside the function)
     * @param g The first script on the page (to be found inside the function)
     * @param tc Tracker Configuration that is returned from the server
     */
    function initializePanoramaTracker(r, p, l, o, w, i, n, g, tc) {
        log("panoInitInitializingTrackerStart", 1);

        if (!p[i] || p[i].enabled) {
            p.GlobalSnowplowNamespace = p.GlobalSnowplowNamespace || [];
            p.GlobalSnowplowNamespace.push(i);
            p[i] = function () {
                (p[i].q = p[i].q || []).push(arguments);
            };
            p[i].q = p[i].q || [];
            p[i].trackCustomEvent = function () {
                [].unshift.call(arguments, "trackCustomEvent");
                p[i].apply(this, arguments);
            };

            p[i].loadTime = Date.now();
            p[i].enabled = true;
            n = l.createElement(o);
            g = l.getElementsByTagName(o)[0];
            n.onload = function () {
                if (p[i] && typeof p[i] === "function") {
                    p[i]("openOutqueue");
                }
                dispatchPanoramaLoadEvent(true);
            };
            n.onerror = function () {
                dispatchPanoramaLoadEvent(false);
            };
            n.async = 1;
            n.src = w;
            g.parentNode.insertBefore(n, g);
        }

        var LOG_ENDPOINT = getLogEndpoint(r);

        // Initialise panorama tracker
        windowAlias.panorama("newTracker", "cf", "https://" + r + LOG_ENDPOINT, tc);

        log("panoInitInitializingTrackerEnd", 1);
    }
})();
