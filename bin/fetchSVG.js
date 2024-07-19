const got = require("got");
const { ensureDir, writeFile } = require("fs-extra");
const { join, resolve } = require("path");
const Figma = require("figma-js");
const PQueue = require("p-queue");
require("dotenv").config();

process.env.HTTP_PROXY = '';
process.env.HTTPS_PROXY = '';

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_FILE_URL = process.env.FIGMA_FILE_URL;
// const FIGMA_FILE_URL = "https://www.figma.com/file/BLDKl9ojyEdIHQz2Ym35dv/test";
const BATCH_SIZE = 100; // 新增：定义批处理大小

if (!FIGMA_TOKEN) {
    throw Error("Cannot find FIGMA_TOKEN in process! Please check your .env file.");
}

console.log("FIGMA_TOKEN found:", FIGMA_TOKEN.substring(0, 5) + "...");

const options = {
    format: "svg",
    outputDir: "./src/",
    scale: "1",
};

for (const arg of process.argv.slice(2)) {
    const [param, value] = arg.split("=");
    if (options[param]) {
        options[param] = value;
    }
}

const client = Figma.Client({
    personalAccessToken: FIGMA_TOKEN,
});

let fileId = null;
try {
    fileId = FIGMA_FILE_URL.match(/file\/([a-z0-9]+)\//i)[1];
    console.log("Extracted fileId:", fileId);
} catch (e) {
    throw Error(`Cannot extract file ID from FIGMA_FILE_URL: ${FIGMA_FILE_URL}`);
}

console.log(`Exporting ${FIGMA_FILE_URL} components`);

client
    .file(fileId)
    .then(({ data }) => {
        console.log("Response received from Figma API");
        const components = {};

        function check(c) {
            if (c.type === "COMPONENT") {
                console.log("Found component:", c.name);
                const { name, id } = c;
                const { description = "", key } = data.components[c.id] || {};
                const { width, height } = c.absoluteBoundingBox || {};

                components[id] = {
                    name,
                    id,
                    key,
                    file: fileId,
                    description,
                    width,
                    height,
                };
            } else if (c.children) {
                console.log("Checking children of:", c.name || "Unnamed");
                c.children.forEach(check);
            }
        }

        data.document.children.forEach(check);
        
        const componentCount = Object.values(components).length;
        if (componentCount === 0) {
            throw Error("No components found in the Figma file!");
        }
        console.log(`${componentCount} components found in the Figma file`);
        return components;
    })
    .then((components) => {
        console.log("Getting export URLs for components");
        const componentIds = Object.keys(components);
        const batches = [];
        
        for (let i = 0; i < componentIds.length; i += BATCH_SIZE) {
            const batch = componentIds.slice(i, i + BATCH_SIZE);
            batches.push(batch);
        }

        return batches.reduce((promise, batch) => {
            return promise.then((result) => {
                return client.fileImages(fileId, {
                    format: options.format,
                    ids: batch,
                    scale: options.scale,
                }).then(({ data }) => {
                    console.log(`Received export URLs for ${batch.length} components`);
                    Object.assign(result, data.images);
                    return result;
                });
            });
        }, Promise.resolve({})).then((images) => {
            console.log("All export URLs received");
            for (const id of Object.keys(images)) {
                components[id].image = images[id];
            }
            return components;
        });
    })
    .then((components) => {
        console.log("Ensuring output directory exists");
        return ensureDir(join(options.outputDir))
            .then(() => {
                console.log("Writing data.json");
                return writeFile(
                    resolve(options.outputDir, "data.json"),
                    JSON.stringify(components),
                    "utf8"
                );
            })
            .then(() => components);
    })
    .then((components) => {
        const contentTypes = {
            svg: "image/svg+xml",
            png: "image/png",
            jpg: "image/jpeg",
        };
        console.log("Starting to download and save component images");
        return queueTasks(
            Object.values(components).map((component) => () => {
                console.log(`Downloading ${component.name}`);
                return got
                    .get(component.image, {
                        headers: {
                            "Content-Type": contentTypes[options.format],
                        },
                        encoding: options.format === "svg" ? "utf8" : null,
                    })
                    .then((response) => {
                        console.log(`Saving ${component.name}.${options.format}`);
                        return ensureDir(join(options.outputDir, options.format))
                            .then(() =>
                                writeFile(
                                    join(options.outputDir, options.format, `${component.name}.${options.format}`),
                                    response.body,
                                    options.format === "svg" ? "utf8" : "binary"
                                )
                            );
                    });
            })
        );
    })
    .then(() => {
        console.log("All components exported successfully!");
    })
    .catch((error) => {
        console.error("Detailed error:", error);
        throw Error(`Error fetching components from Figma: ${error.message}`);
    });

function queueTasks(tasks, queueOptions) {
    const queue = new PQueue(Object.assign({ concurrency: 3 }, queueOptions));
    for (const task of tasks) {
        queue.add(task);
    }
    queue.start();
    return queue.onIdle();
}
