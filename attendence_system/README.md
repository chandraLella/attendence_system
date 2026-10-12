1) Create a virtual env and install all the requirements in requirements.txt
2) Start the apis of insightface backend in terminal 1
    uvicorn webapp.main:app --port 8000
3) Run the ui in terminal 2
    cd frontend
    npm install
    npm run dev  # http://localhost:5173