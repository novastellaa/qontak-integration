const form = document.querySelector("form");
const messageInput = document.getElementById("message");
const responseEl = document.getElementById("response");
const messageBtn = document.getElementById("message-btn");

form.addEventListener("submit", async(e) => {
    e.preventDefault();

    messageBtn.disabled = true;
    messageBtn.innerHTML = "Sending...";

    const formData = new FormData();
    formData.append("message", messageInput.value);
    formData.append("file", document.getElementById("file").files[0]);
    try {
        const res = await fetch("http://localhost:5000/api/flowise", {
            method: "POST",
            body: formData,
        });

        const data = await res.json();
        console.log("Response from server:", data);

        if (data.text) {
            responseEl.innerHTML = data.text;
        } else if (data.message) {
            responseEl.innerHTML = data.message; // mungkin ini error dari backend
        } else {
            responseEl.innerHTML = "Tidak ada respons dari server.";
        }


    } catch (error) {
        responseEl.innerHTML = "Error: " + error.message;
    } finally {
        messageBtn.disabled = false;
        messageBtn.innerHTML = "Send";
        messageInput.value = "";
        document.getElementById("file").value = "";
    }
});