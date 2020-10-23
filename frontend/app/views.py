from django.shortcuts import render
from .models import *
import requests

def search(request):
	
	if request.method == 'POST':
		query = request.POST.get('search')
		# print(query)
		# resp = requests.get("http://127.0.0.1:8000/api/queryapi/?query={}".format(query))
		# data = resp.json()
		# print(data)
		cb1 = request.POST.get('cb1')
		cb2 = request.POST.get('cb2')
		cb3 = request.POST.get('cb3')
		res = QueryInfo.objects.filter(query__icontains=query)
		# print(res)
		# print(res)
		if query:
			return render(request,'google_sec.html',{'data':res,'query':query})
		else:
			return render(request,'search-eng.html')
		# return render(request,'app/search.html',{'data':data})
	return render(request,'search-eng.html')





