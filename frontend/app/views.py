from django.shortcuts import render
from .models import *
import requests

def search(request):
	resp = requests.get('http://127.0.0.1:8000/api/queryapi/')
	if request.method == 'POST':
		query = request.POST.get('search')
		cb1 = request.POST.get('cb1')
		cb2 = request.POST.get('cb2')
		cb3 = request.POST.get('cb3')
		res = QueryInfo.objects.filter(query__icontains=query)
		print(res)
	return render(request,'app/search.html')





