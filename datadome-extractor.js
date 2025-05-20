const https = require("https");
const fs = require("fs");
const zlib = require("zlib");
const url = new URL(
  "https://geo.captcha-delivery.com/captcha/?initialCid=AHrlqAAAAAMA1QGvUmJwyYoAwpyjNg%3D%3D&hash=789361B674144528D0B7EE76B35826&cid=6QAEcL8coBYTi9tYLmjCdyKmNNyHz1xwM2tMHHGVd_Rxr6FsWrb7H~a04csMptCPYfQ25CBDmaOZpdDa4qwAigFnsrzbCkVkoaBIXVAwHsjXJaKYXsTpkBPtqJfLMGN&t=fe&referer=https%3A%2F%2bck.websiteurl.com%2Fclient%2Fregister%2FYM4HJV%3Flang%3Den&s=40070&e=3e531bd3b30650f2e810ac72cd80adb5eaa68d2720e804314d122fa9e84ac25d",
);

// Options for the HTTPS request
const options = {
  hostname: url.hostname,
  path: url.pathname + url.search,
  method: "GET",
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  },
};

// Make the request
const req = https.request(options, (res) => {
  // Create appropriate stream based on content encoding
  let responseStream;
  const encoding = res.headers["content-encoding"];
  console.log("Response encoding:", encoding);

  if (encoding === "gzip") {
    responseStream = res.pipe(zlib.createGunzip());
  } else if (encoding === "br") {
    responseStream = res.pipe(zlib.createBrotliDecompress());
  } else if (encoding === "deflate") {
    responseStream = res.pipe(zlib.createInflate());
  } else {
    responseStream = res;
  }

  // Initialize data as buffer chunks rather than strings
  const chunks = [];

  responseStream.on("data", (chunk) => {
    chunks.push(chunk);
  });

  responseStream.on("end", () => {
    console.log("Response status code:", res.statusCode);

    if (res.statusCode === 200) {
      // Convert buffer chunks to string
      const data = Buffer.concat(chunks).toString("utf8");

      // Save raw response for debugging
      fs.writeFileSync("full_response.html", data, "utf8");
      console.log("Full decompressed HTML saved to full_response.html");

      // Split the data into lines
      const lines = data.split("\n");

      // Find the line with "DataDome is a cybersecurity solution"
      let dataDomeLineIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("DataDome is a cybersecurity solution")) {
          dataDomeLineIndex = i;
          console.log("Found DataDome comment at line", i);
          break;
        }
      }

      // If found, check the next lines for !function
      if (dataDomeLineIndex !== -1) {
        // Look at the next few lines in case there's whitespace or other content
        for (
          let i = dataDomeLineIndex + 1;
          i < Math.min(dataDomeLineIndex + 5, lines.length);
          i++
        ) {
          if (lines[i].trim().startsWith("!function")) {
            console.log("Found !function at line", i);
            const functionLine = lines[i].trim();
            fs.writeFileSync("input.js", functionLine, "utf8");
            console.log("DataDome JS saved to input.js");
            console.log("Content:", functionLine);
            return;
          }
        }
        console.log("No !function found after DataDome comment");
      } else {
        console.log("DataDome comment not found");

        // Fallback: look for any line starting with !function
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim().startsWith("!function e(t,a,n)")) {
            console.log("Found !function e(t,a,n) at line", i);
            const functionLine = lines[i].trim();
            fs.writeFileSync("input.js", functionLine, "utf8");
            console.log("DataDome JS saved to input.js");
            console.log("Content:", functionLine);
            return;
          }
        }
        console.log("No !function e(t,a,n) found in the entire response");
      }
    } else {
      console.error(
        "Failed to retrieve the page. Status code:",
        res.statusCode,
      );
    }
  });

  responseStream.on("error", (error) => {
    console.error("Error decompressing response:", error);
  });
});

// Handle request errors
req.on("error", (error) => {
  console.error("Request error:", error);
});

// Complete the request
req.end();
